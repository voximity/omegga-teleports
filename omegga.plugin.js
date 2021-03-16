const {Vector3, Ray, rayIntersectsPrism} = require("./math.js");
const {red, yellow, green, cyan, blue, magenta, white, gray} = require("./colors");

const playerSize = new Vector3(12.5, 12.5, 24);

module.exports = class Teleports {
    constructor(omegga, config, store) {
        this.omegga = omegga;
        this.config = config;
        this.store = store;
    }

    teleportPlayer(player, pos) {
        this.omegga.writeln(`Chat.Command /TP "${player}" ${pos.join(" ")}`);
    }

    getOrCreatePlayerData(pid) {
        if (this.playerData[pid] == null) {
            this.playerData[pid] = {last: null, awaitingTeleport: {}, ignore: false, cooldown: false};
        }
        return this.playerData[pid];
    }

    getAndUpdateLastPosition(pp) {
        const last = this.getOrCreatePlayerData(pp.player.name).last;
        this.playerData[pp.player.name].last = pp.pos;
        return last;
    }

    async teleportCheck() {
        try {
            const playerPositions = await this.omegga.getAllPlayerPositions();

            playerPositions.forEach((pp) => {
                // for each player...
                const lastPosition = this.getAndUpdateLastPosition(pp);
                if (lastPosition == null) return;

                const pData = this.getOrCreatePlayerData(pp.player.name);
                if (pData.ignore) return;

                const newPos = new Vector3(...pp.pos);
                const oldPos = new Vector3(...lastPosition);
                const diffPos = newPos.subtract(oldPos);
                
                const ray = new Ray(newPos, diffPos);

                this.tps.forEach((tp) => {
                    // check tps
                    const inTeleport = [false, false];
                    for (let i = 0; i <= 1; i++) {
                        const canTp = !(tp.oneWay && i == 1);

                        const center = new Vector3(...tp.positions[i]);

                        let inZone = false;
                        let inZoneToTp = false;
                        let finalTpPos;
                        if (tp.shape == "sphere") {
                            const newToCenterMagnitude = newPos.subtract(center).magnitude();
                            if (newPos.subtract(center).magnitude() <= tp.radius) {
                                inZone = true;
                                
                                const reducedRadius = radius - newPos.subtract(center).normalize().multiply(playerSize).magnitude();
                                if (tp.safe && reducedRadius > 0 && newToCenterMagnitude <= reducedRadius) inZoneToTp = true;
                                else if (!tp.safe || reducedRadius < 0) inZoneToTp = true;
                            } else {
                                const closestPoint = ray.closestPoint(center);
                                const pointDistToNew = newPos.subtract(closestPoint);
                                const pointDistToNewMagnitude = pointDistToNew.magnitude();
                                const pointDistToSphere = closestPoint.subtract(center).magnitude();

                                const reducedRadius = radius - closestPoint.subtract(center).normalize().multiply(playerSize).magnitude();

                                // ensure closest point is within actual range of new - old AND closest point is in sphere
                                if (pointDistToNewMagnitude <= diffPos.magnitude() && pointDistToSphere <= tp.radius) {
                                    inZone = true;
                                    if (tp.safe && reducedRadius > 0 && pointDistToSphere <= reducedRadius) inZoneToTp = true;
                                    else if (!tp.safe || reducedRadius < 0) inZoneToTp = true;
                                }
                            }

                            if (inZone)
                                finalTpPos = new Vector3(...tp.positions[1 - i]).add(newPos.subtract(center));
                        } else if (tp.shape == "prism") {
                            const newPosDiff = newPos.subtract(center).abs();
                            let size = new Vector3(...tp.sizes[i]);
                            let reducedSize = size.subtract(playerSize);

                            if (newPosDiff.x <= size.x && newPosDiff.y <= size.y && newPosDiff.z <= size.z) {
                                inZone = true;
                                if (newPosDiff.dimensionsLessThan(reducedSize) && tp.safe) inZoneToTp = true;
                                else if (!tp.safe) inZoneToTp = true;
                            } else {
                                if (rayIntersectsPrism(ray, center, size, diffPos.magnitude())) {
                                    inZone = true;
                                    if (tp.safe && playerSize.dimensionsLessThan(size) && rayIntersectsPrism(ray, center, reducedSize, diffPos.magnitude())) {
                                        inZoneToTp = true;
                                    } else if (!tp.safe || !playerSize.dimensionsLessThan(size)) {
                                        inZoneToTp = true;
                                    }
                                }
                            }

                            if (inZone)
                                finalTpPos = new Vector3(...tp.positions[1 - i]).add(newPos.subtract(center));
                        }

                        if (inZone) {
                            // we intersect with this point
                            inTeleport[i] = true;
                                    
                            // check if we are awaiting teleport on OPPOSITE teleporter
                            if (pData.awaitingTeleport[tp.name] == 1 - i) {
                                pData.awaitingTeleport[tp.name] = i;
                            } else if (pData.awaitingTeleport[tp.name] == null && canTp && Date.now() - pData.cooldown > 2000 / this.config["poll-rate"] && inZoneToTp) {
                                // teleport the player
                                this.teleportPlayer(pp.player.name, finalTpPos.toArray());
                                pData.awaitingTeleport[tp.name] = i;
                                pData.cooldown = Date.now();
                            }
                        }
                    }

                    if (!inTeleport.some(p => p) && pData.awaitingTeleport[tp.name] != null && Date.now() - pData.cooldown > 2000 / this.config["poll-rate"]) {
                        // we are not in any teleports
                        delete pData.awaitingTeleport[tp.name];
                        pData.cooldown = null;
                    }
                });
            });
        } catch (e) {
            console.log(e);
            clearInterval(this.teleportInterval);
        }
    }

    userIsAuthed(user) {
        return this.omegga.getPlayer(user).isHost() || this.config.authorized.some((u) => u.name == user);
    }

    async addTp(tp) {
        const tpslist = await this.store.get("tps");
        tpslist.push(tp.name);

        this.tps.push(tp);
        await this.store.set(`tp_${tp.name}`, tp);
        await this.store.set("tps", tpslist);
        // todo: add to store
    }

    async removeTp(i) {
        const tp = this.tps[i];
        const tpslist = await this.store.get("tps");
        tpslist.splice(tpslist.indexOf(tp.name), 1);
        await this.store.set("tps", tpslist);
        this.tps.splice(i, 1);
    }

    async getPlayerChatMessage(user) {
        if (this.playerPromises[user] != null) throw "Already awaiting chat message.";

        return await new Promise((resolveRaw, reject) => {

            const timeout = setTimeout(() => {
                delete this.playerPromises[user];
                reject("Timed out: no response from user");
            }, 60 * 1000); // 60 second timeout period

            const resolve = (message) => {
                clearTimeout(timeout);
                delete this.playerPromises[user];
                resolveRaw(message);
            }

            this.playerPromises[user] = {resolve};
        });
    }
    
    async init() {
        try {
            this.playerData = [];
            this.tps = [];
            this.playerPromises = {};

            // load from store
            let tpslist = await this.store.get("tps");
            if (tpslist == null) {
                await this.store.set("tps", []);
                tpslist = [];
            }
            tpslist.forEach(async (tpName) => {
                const tp = await this.store.get(`tp_${tpName}`);
                this.tps.push(tp);
            });

            this.omegga.on("chat", async (user, message) => {
                if (this.playerPromises[user]) {
                    this.playerPromises[user].resolve(message);
                    delete this.playerPromises[user];
                }
            });

            this.omegga.on("cmd:tps", async (user, subcommand, ...args) => {
                const authed = this.userIsAuthed(user);
                const player = this.omegga.getPlayer(user);
                if (subcommand == null) {
                    // no subcommand
                    this.omegga.whisper(user, yellow("<b>Teleports Plugin</b>"));
                    const subcommands = [["list", "Show a list of teleports."], ["ignore", "Toggle ignoring teleports."], ["create", "Create a new teleporter."], ["remove", "Delete an existing teleporter by standing in one of its zones."]];

                    subcommands.forEach((sub) => {
                        this.omegga.whisper(user, gray("- ") + `<code>/tps ${sub[0]}</>: ${sub[1]}`);
                    });
                } else if (subcommand == "list") {
                    if (!authed) return;

                    // list existing tps
                    this.omegga.whisper(user, yellow("<b>List of Teleporters</>"));

                    this.tps.forEach((tp) => {
                        this.omegga.whisper(user, yellow(`<b>${tp.name}</>`) + `: ${tp.shape}, ${tp.oneWay ? red("one-way") : cyan("both ways")}, ${tp.safe ? green("safe") + " teleporting" : cyan("normal") + " teleporting"}`);
                    });

                    if (this.tps.length == 0)
                        this.omegga.whisper(user, red("No teleporters have been created. Create one with <code>/tps create</>."));
                } else if (subcommand == "ignore") {
                    if (!authed) return;
                    const pData = this.getOrCreatePlayerData(user);
                    pData.ignore = !pData.ignore;

                    this.omegga.whisper(user, `<color="ff0">You will ${pData.ignore ? "no longer" : "now"} interact with teleports. Run the command again to toggle.</>`);
                } else if (subcommand == "create" || subcommand == "new") {
                    if (!authed) return;

                    // create a new tp
                    if (this.playerPromises[user] != null)
                        return this.omegga.whisper(user, red("Plugin is pending response from you already."));
                    
                    this.omegga.whisper(user, white("<i>To answer each of these prompts, please respond in chat normally.</>"));

                    // get a name
                    this.omegga.whisper(user, yellow("Please state a name for your new teleporter."));
                    let name;
                    while (true) {
                        const nameSpecified = await this.getPlayerChatMessage(user);
                        if (this.tps.some((tp) => tp.name.toLowerCase() == nameSpecified.toLowerCase())) {
                            this.omegga.whisper(user, red("A teleporter already exists by that name. Please choose a different name for your teleporter."));
                        } else {
                            name = nameSpecified;
                            break;
                        }
                    }

                    // portal is one way?
                    this.omegga.whisper(user, yellow("Is this teleporter one-way? One-way teleporter can only be entered from one way, and cannot be exited through the second point. Chat <code>yes</> or <code>no.</>"));
                    let oneWay;
                    while (true) {
                        const oneWaySpecified = (await this.getPlayerChatMessage(user)).toLowerCase();
                        if (oneWaySpecified.startsWith("y")) {
                            oneWay = true;
                            break;
                        } else if (oneWaySpecified.startsWith("n")) {
                            oneWay = false;
                            break;
                        } else {
                            this.omegga.whisper(user, red("Please choose <code>yes</> or <code>no</>. Is the teleporter one-way?"));
                        }
                    }

                    // get shape
                    this.omegga.whisper(user, yellow("Choose a shape for your teleporter's entry and exit. The shape must be either <code>sphere</> or <code>prism</>."));
                    this.omegga.whisper(user, white("A <code>sphere</> teleporter will act as a sphere in space with a radius. When the sphere is entered, teleportation occurs."));
                    this.omegga.whisper(user, white("A <code>prism</> teleporter will act as two separate prisms in space (block shaped). You can define this shape with your selector. Great for rectangular doors/portals."));
                    let shape;
                    while (true) {
                        const shapeSpecified = await this.getPlayerChatMessage(user);
                        if (shapeSpecified == "sphere" || shapeSpecified == "prism") {
                            shape = shapeSpecified;
                            break;
                        } else {
                            this.omegga.whisper(user, red(`<code>${shapeSpecified}</> is not a valid shape. Please specify one of <code>sphere</> or <code>prism</>.`));
                        }
                    }

                    this.omegga.whisper(user, yellow("Will this teleporter use safe teleporting? Respond with <code>yes</> or <code>no</>."));
                    this.omegga.whisper(user, white("Safe teleporting ensures that the <i>entire</> player is within a teleport zone before teleporting. This prevents getting stuck in floors, walls, etc. after teleporting."));
                    this.omegga.whisper(user, white("Normal (unsafe) teleporting will teleport the player as soon as the player's center moves into zone."));
                    let safe;
                    while (true) {
                        const safeSpecified = await this.getPlayerChatMessage(user);
                        if (safeSpecified.startsWith("y")) {
                            safe = true;
                            break;
                        } else if (safeSpecified.startsWith("n")) {
                            safe = false;
                            break;
                        } else {
                            this.omegga.whisper(user, red("Please choose <code>yes</> or <code>no</>. Is the teleporter safe?"));
                        }
                    }

                    // depending on shape, get positions/sizes of entry/exit
                    if (shape == "sphere") {
                        this.omegga.whisper(user, yellow("Move to the first point you'd like to set the teleporter. When you are in position, chat <code>here</>."));
                        let pointA;
                        while (true) {
                            const confirm = await this.getPlayerChatMessage(user);
                            if (confirm == "here") {
                                const position = await player.getPosition();
                                pointA = position;
                                break;
                            } else {
                                this.omegga.whisper(user, red("Please chat <code>here</> when you are in position."));
                            }
                        }

                        this.omegga.whisper(user, yellow("Move to the second point you'd like to set the teleporter. When you are in position, chat <code>here</>."));
                        if (oneWay) this.omegga.whisper(user, white("Since this teleporter is one-way, you will not be able to teleport from this point."));
                        let pointB;
                        while (true) {
                            const confirm = await this.getPlayerChatMessage(user);
                            if (confirm == "here") {
                                const position = await player.getPosition();
                                pointB = position;
                                break;
                            } else {
                                this.omegga.whisper(user, red("Please chat <code>here</> when you are in position."));
                            }
                        }

                        this.omegga.whisper(user, yellow("Please type the radius (in studs) of the teleporter's range. If you are unsure, a decent value is <code>5</>."));
                        let radius;
                        while (true) {
                            const radiusSpecified = await this.getPlayerChatMessage(user);
                            const parsed = parseInt(radiusSpecified);
                            if (isNaN(parsed) || parsed <= 0) {
                                this.omegga.whisper(user, red("Please enter a valid stud count for the radius of the teleporters."));
                            } else {
                                radius = parsed * 10;
                                break;
                            }
                        }

                        this.addTp({name, shape, positions: [pointA, pointB], radius, oneWay, safe});
                        this.omegga.whisper(user, cyan(`The teleporter ${name} has been created!`));
                    } else if (shape == "prism") {
                        this.omegga.whisper(user, yellow("Select and copy some bricks using the selector to define the first teleport zone. When you are done, chat <code>done</>."));
                        this.omegga.whisper(user, white("You may have to create bricks in order to fully create your zone, or even use an invisible brick."));
                        let zoneABounds;
                        while (true) {
                            const confirm = await this.getPlayerChatMessage(user);
                            if (confirm.toLowerCase() == "done") {
                                const bounds = await player.getTemplateBounds();
                                if (bounds == null) {
                                    this.omegga.whisper(user, red("Please select and copy (some) brick(s) to set the first teleporter zone and chat <code>done</> again."));
                                } else {
                                    zoneABounds = bounds;
                                    break;
                                }
                            } else {
                                this.omegga.whisper(user, red("Please chat <code>done</> when you have copied the brick(s) to set as the first teleporter zone."));
                            }
                        }
                        
                        this.omegga.whisper(user, yellow("Repeat this procedure for the second zone. When you are done, chat <code>done</>."));
                        if (oneWay) this.omegga.whisper(user, white("Since this teleporter is one-way, this zone will not teleport the player, only the first one will."));
                        let zoneBBounds;
                        while (true) {
                            const confirm = await this.getPlayerChatMessage(user);
                            if (confirm.toLowerCase() == "done") {
                                const bounds = await player.getTemplateBounds();
                                if (bounds == null) {
                                    this.omegga.whisper(user, red("Please select and copy (some) brick(s) to set the second teleporter zone and chat <code>done</> again."));
                                } else {
                                    zoneBBounds = bounds;
                                    break;
                                }
                            } else {
                                this.omegga.whisper(user, red("Please chat <code>done</> when you have copied the brick(s) to set as the second teleporter zone."));
                            }
                        }

                        const positions = [zoneABounds.center, zoneBBounds.center];
                        const sizeA = [zoneABounds.maxBound[0] - zoneABounds.center[0], zoneABounds.maxBound[1] - zoneABounds.center[1], zoneABounds.maxBound[2] - zoneABounds.center[2]];
                        const sizeB = [zoneBBounds.maxBound[0] - zoneBBounds.center[0], zoneBBounds.maxBound[1] - zoneBBounds.center[1], zoneBBounds.maxBound[2] - zoneBBounds.center[2]];

                        const tp = {name, shape, positions, sizes: [sizeA, sizeB], oneWay, safe};
                        console.log(JSON.stringify(tp));
                        this.addTp(tp);
                        this.omegga.whisper(user, cyan(`The teleporter ${name} has been created!`));
                    }
                } else if (subcommand == "delete" || subcommand == "remove") {
                    // remove a tp
                    if (!authed) return;

                    if (args.length > 0) {
                        const passedName = args.join(" ");

                        let foundTp;
                        this.tps.forEach((tp) => {
                            if (tp.name.toLowerCase() == passedName.toLowerCase()) {
                                foundTp = tp;
                                return;
                            }
                        });

                        if (foundTp) {
                            this.removeTp(this.tps.indexOf(foundTp));
                            this.omegga.whisper(user, yellow(`Teleporter <b>${foundTp.name}</> was removed.`));
                        } else {
                            this.omegga.whisper(user, red("Unable to find a teleporter by that name."));
                        }
                        return;
                    }

                    const pos = new Vector3(...(await Omegga.getPlayer(user).getPosition()));
                    let tpIn;
                    let tpInd = 0;
                    this.tps.forEach((tp) => {
                        if (tpIn != null) return;

                        let inZone = false;

                        for (let i = 0; i <= 1; i++) {
                            const zonePos = new Vector3(...tp.positions[i]);
                            if (tp.shape == "sphere") {
                                if (pos.subtract(zonePos).magnitude() <= tp.radius) inZone = true;
                            } else if (tp.shape == "prism") {
                                const diff = pos.subtract(zonePos).abs();
                                const size = new Vector3(...tp.sizes[i]);
                                if (diff.x <= size.x && diff.y <= size.y && diff.z <= size.z) inZone = true;
                            }
                        }

                        if (inZone)
                            tpIn = tp;
                        else
                            tpInd++;
                    });

                    if (tpIn != null) {
                        this.removeTp(tpInd);
                        this.omegga.whisper(user, yellow(`Teleporter <b>${tp.name}</> was removed.`));
                    } else this.omegga.whisper(user, red("Stand in a teleporter zone to remove it. You may need to use <code>/tps ignore</> to prevent being teleported."));
                } else {
                    this.omegga.whisper(user, red("Invalid subcommand. Use <code>/tps</code> to view teleporter commands."));
                }
            });

            this.teleportInterval = setInterval(async () => await this.teleportCheck(), 1000 / this.config["poll-rate"]);
        } catch (e) {console.log(e)}

        return {"registeredCommands": ["tps"]};
    }

    async stop() {
        clearInterval(this.teleportInterval);
    }
}
