const fs = require("fs");
const {Vector3, Ray, rayIntersectsPrism} = require("./math.js");
const {red, yellow, green, cyan, blue, magenta, white, gray} = require("./colors");

const ASSUMED_LATENCY = 40;

let playerSize = new Vector3(12.5, 12.5, 24);
playerSize = playerSize.subtract(new Vector3(0, 0, 3)); // a little extra leeway (mostly for flying)

module.exports = class Teleports {
    constructor(omegga, config, store) {
        this.omegga = omegga;
        this.config = config;
        this.store = store;
        this.lastCheckTime = 0;
    }

    teleportPlayer(player, pos) {
        this.omegga.writeln(`Chat.Command /TP "${player}" ${pos.join(" ")}`);
    }

    getOrCreatePlayerData(pid) {
        if (this.playerData[pid] == null) {
            this.playerData[pid] = {last: null, awaitingTeleport: {}, ignore: false, cooldown: false, lastTime: Date.now()};
        }
        return this.playerData[pid];
    }

    getAndUpdateLastPosition(pp) {
        const last = this.getOrCreatePlayerData(pp.player.name).last;
        const lastTime = this.getOrCreatePlayerData(pp.player.name).lastTime;
        this.playerData[pp.player.name].last = pp.pos;
        this.playerData[pp.player.name].lastTime = Date.now();
        return [last, lastTime];
    }

    async teleportCheck() {
        try {
            const timeBeforeCheck = Date.now();
            const playerPositions = await this.omegga.getAllPlayerPositions();
            const timeAfterCheck = Date.now();
            const deltaAwaitTime = timeAfterCheck - timeBeforeCheck;

            playerPositions.forEach((pp) => {
                // for each player...
                const [lastPosition, lastTime] = this.getAndUpdateLastPosition(pp);
                if (lastPosition == null) return;

                const pData = this.getOrCreatePlayerData(pp.player.name);
                if (pData.ignore) return;
                const deltaCheckTime = Date.now() - lastTime;

                const newPos = new Vector3(...pp.pos);
                const oldPos = new Vector3(...lastPosition);
                const diffPos = newPos.subtract(oldPos);
                
                const ray = new Ray(oldPos, diffPos);

                this.tps.forEach((tp) => {
                    // check tps
                    const inTeleport = [false, false];
                    for (let i = 0; i <= 1; i++) {
                        const canTp = !(tp.oneWay && i == 1);

                        const center = new Vector3(...tp.positions[i]);

                        let scaledRelativeSize = new Vector3(1, 1, 1);
                        if (tp.safe && tp.shape == "prism") scaledRelativeSize = new Vector3(tp.sizes[1 - i][0] / tp.sizes[i][0], tp.sizes[1 - i][1] / tp.sizes[i][1], tp.sizes[1 - i][2] / tp.sizes[i][2]);

                        let inZone = false;
                        let inZoneToTp = false;
                        let finalTpPos;
                        if (tp.shape == "sphere") {
                            const radius = tp.radius;
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

                            const safeAndFitsInOrTrue = tp.safe ? playerSize.dimensionsLessThan(size) : true;

                            if (safeAndFitsInOrTrue && newPosDiff.dimensionsLessThan(size)) {
                                inZone = true;
                                //if (tp.safe && newPosDiff.dimensionsLessThan(reducedSize)) inZoneToTp = true;
                                /*else */if (!tp.safe) inZoneToTp = true;
                            } 
                            {
                                const intersectionNormal = rayIntersectsPrism(ray, center, size, diffPos.magnitude());
                                if (intersectionNormal != null) {
                                    inZone = true;
                                    const intersectionNormalInner = rayIntersectsPrism(ray, center, reducedSize, diffPos.magnitude());
                                    const playerFitsInFullZone = playerSize.dimensionsLessThan(size);

                                    if (tp.safe) {
                                        if (playerFitsInFullZone && intersectionNormalInner != null) {
                                            inZoneToTp = true;
                                            finalTpPos = new Vector3(...tp.positions[1 - i]).add(newPos.subtract(center).multiply(scaledRelativeSize));
    
                                            const nextCenter = new Vector3(...tp.positions[1 - i]);
    
                                            // use opposite signs (negative normal is player direction)
                                            if (intersectionNormalInner.x == -1) finalTpPos = new Vector3(Math.min(finalTpPos.x, nextCenter.x - playerSize.x / 2), finalTpPos.y, finalTpPos.z);
                                            if (intersectionNormalInner.y == -1) finalTpPos = new Vector3(finalTpPos.x, Math.min(finalTpPos.y, nextCenter.y - playerSize.y / 2), finalTpPos.z);
                                            if (intersectionNormalInner.z == -1) finalTpPos = new Vector3(finalTpPos.x, finalTpPos.y, Math.min(finalTpPos.z, nextCenter.z - playerSize.z / 2));
    
                                            if (intersectionNormalInner.x ==  1) finalTpPos = new Vector3(Math.max(finalTpPos.x, nextCenter.x + playerSize.x / 2), finalTpPos.y, finalTpPos.z);
                                            if (intersectionNormalInner.y ==  1) finalTpPos = new Vector3(finalTpPos.x, Math.max(finalTpPos.y, nextCenter.y + playerSize.y / 2), finalTpPos.z);
                                            if (intersectionNormalInner.z ==  1) finalTpPos = new Vector3(finalTpPos.x, finalTpPos.y, Math.max(finalTpPos.z, nextCenter.z + playerSize.z / 2));
                                        } else if (!playerFitsInFullZone && intersectionNormal != null && !oldPos.in(center, size)) {
                                            inZoneToTp = true;
                                            finalTpPos = new Vector3(...tp.positions[1 - i]).add(newPos.subtract(center).multiply(scaledRelativeSize));
    
                                            const nextCenter = new Vector3(...tp.positions[1 - i]);
    
                                            // use opposite signs (negative normal is player direction)
                                            if (intersectionNormal.x == -1) finalTpPos = new Vector3(Math.min(finalTpPos.x, nextCenter.x - playerSize.x / 2), finalTpPos.y, finalTpPos.z);
                                            if (intersectionNormal.y == -1) finalTpPos = new Vector3(finalTpPos.x, Math.min(finalTpPos.y, nextCenter.y - playerSize.y / 2), finalTpPos.z);
                                            if (intersectionNormal.z == -1) finalTpPos = new Vector3(finalTpPos.x, finalTpPos.y, Math.min(finalTpPos.z, nextCenter.z - playerSize.z / 2));
    
                                            if (intersectionNormal.x ==  1) finalTpPos = new Vector3(Math.max(finalTpPos.x, nextCenter.x + playerSize.x / 2), finalTpPos.y, finalTpPos.z);
                                            if (intersectionNormal.y ==  1) finalTpPos = new Vector3(finalTpPos.x, Math.max(finalTpPos.y, nextCenter.y + playerSize.y / 2), finalTpPos.z);
                                            if (intersectionNormal.z ==  1) finalTpPos = new Vector3(finalTpPos.x, finalTpPos.y, Math.max(finalTpPos.z, nextCenter.z + playerSize.z / 2));
                                        }
                                    } else {
                                        inZoneToTp = true;
                                    }
                                }
                            }

                            if (inZone && finalTpPos == null) {
                                finalTpPos = new Vector3(...tp.positions[1 - i]).add(newPos.subtract(center).multiply(scaledRelativeSize));
                            }
                        }

                        if (inZone) {
                            // we intersect with this point
                            inTeleport[i] = true;
                                    
                            // check if we are awaiting teleport on OPPOSITE teleporter
                            if (pData.awaitingTeleport[tp.name] == 1 - i) {
                                pData.awaitingTeleport[tp.name] = i;
                            } else if (pData.awaitingTeleport[tp.name] == null && canTp && Date.now() - pData.cooldown > 120 && inZoneToTp) {
                                // teleport the player

                                // account for potential latency
                                let compensation = diffPos.scale(1000 / deltaCheckTime).scale(ASSUMED_LATENCY / 1000);
                                compensation = compensation.normalize().scale(Math.min(compensation.magnitude(), 10)); // compensate no farther than 10 units
                                finalTpPos = finalTpPos.add(compensation);

                                this.teleportPlayer(pp.player.name, finalTpPos.toArray());
                                pData.awaitingTeleport[tp.name] = i;
                                pData.last = finalTpPos.toArray();
                                pData.lastTime = Date.now();
                            }
                        }
                    }

                    if (!inTeleport[0] && !inTeleport[1] && pData.awaitingTeleport[tp.name] != null && Date.now() - pData.cooldown > 120) {
                        // we are not in any teleports
                        delete pData.awaitingTeleport[tp.name];
                        pData.cooldown = null;
                    } else {
                        if ((inTeleport[0] || inTeleport[1]) && pData.awaitingTeleport[tp.name] != null)
                            pData.cooldown = Date.now();
                    }
                });
            });
        } catch (e) {
            console.log(e);
            clearInterval(this.teleportInterval);
        }
    }

    userIsBanned(user) {
        return this.bans.includes(user);
    }

    userIsAuthed(user) {
        return this.omegga.getPlayer(user).isHost() || this.config.authorized.some((u) => u.name == user);
    }

    userCanMakeTps(user) {
        return !this.userIsBanned(user) && (this.userIsAuthed(user) || this.config["allow-all"] || this.omegga.getPlayer(user).getRoles().some((r) => this.config["allowed-roles"].map((r) => r.toLowerCase()).includes(r.toLowerCase())));
    }

    async addTp(tp) {
        const tpslist = await this.store.get("tps");
        tpslist.push(tp.name);

        this.tps.push(tp);
        await this.store.set(`tp_${tp.name}`, tp);
        await this.store.set("tps", tpslist);
        // todo: add to store
    }

    async removeTpByIndex(i) {
        const tp = this.tps[i];
        const tpslist = await this.store.get("tps");
        tpslist.splice(tpslist.indexOf(tp.name), 1);
        await this.store.delete(`tp_${tp.name}`);
        await this.store.set("tps", tpslist);
        this.tps.splice(i, 1);
    }

    async removeTp(tp) {
        await this.removeTpByIndex(this.tps.indexOf(tp));
    }

    async getPlayerChatMessage(user) {
        if (this.playerPromises[user] != null) throw "Already awaiting chat message.";

        return await new Promise((resolveRaw, reject) => {

            const timeout = setTimeout(() => {
                delete this.playerPromises[user];
                reject("Timed out: no response from user");
            }, 30 * 1000); // 60 second timeout period

            const resolve = (message) => {
                clearTimeout(timeout);
                delete this.playerPromises[user];
                resolveRaw(message);
            }

            this.playerPromises[user] = {resolve};
        });
    }

    async banUser(user) {
        this.bans.push(user);
        await this.store.set("bans", this.bans);
    }

    async unbanUser(user) {
        this.bans.splice(this.bans.indexOf(user), 1);
        await this.store.set("bans", this.bans);
    }
    
    async init() {
        try {
            this.playerData = [];
            this.tps = [];
            this.playerPromises = {};

            // load bans
            this.bans = []
            let banslist = await this.store.get("bans");
            if (banslist == null) {
                await this.store.set("bans", []);
                this.bans = [];
            } else {
                this.bans = banslist;
            }

            // load from store
            let tpslist = await this.store.get("tps");
            if (tpslist == null) {
                await this.store.set("tps", []);
                tpslist = [];
            }
            await Promise.all(tpslist.map(async (tpName) => {
                const tp = await this.store.get(`tp_${tpName}`);
                if (tp == null) {
                    tpslist.splice(tpslist.indexOf(tpName), 1);
                    await this.store.set(`tps`, tpslist);
                    return;
                }
                this.tps.push(tp);
            }));

            this.omegga.on("leave", async (user) => {
                delete this.playerData[user.name];
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
                    const subcommands = [
                        ["list", "Show a list of teleports. <code>list all</> will list all teleports, <code>list X</> will list player X's teleports."],
                        ["ignore", "Toggle ignoring teleports."],
                        ["create", "Create a new teleporter."],
                        ["remove", "Delete an existing teleporter by standing in one of its zones."],
                        ["modify", "Edit an existing teleporter."],
                        ["find", "Provides the name and owner of the nearest teleporter."],
                        ["clearfor", "Clear a user's teleporters."],
                        ["ban", "Ban a user from creating teleports."],
                        ["unban", "Unban a user from creating teleports."],
                        ["bans", "Show a list of banned users."]
                    ];

                    subcommands.forEach((sub) => {
                        this.omegga.whisper(user, gray("- ") + `<code>/tps ${sub[0]}</>: ${sub[1]}`);
                    });
                } else if (subcommand == "list") {
                    const writeTeleport = (tp, isAll) => this.omegga.whisper(user, yellow(`<b>${tp.name}</>`) + `${isAll ? ` by ${tp.owner != null ? cyan(tp.owner) : red("no owner")}` : ""}: ${tp.shape}, ${tp.oneWay ? red("one-way") : cyan("both ways")}, ${tp.safe ? green("safe") : cyan("normal")} teleporting`);
                    const writeTeleportList = (tps) => {
                        if (tps.length > 0) tps.forEach(writeTeleport);
                        else this.omegga.whisper(user, white("No teleports available. Create one with <code>/tps create</>."));  
                    };

                    // by default, show the user's own TPs unless they pass `all` or another name
                    const joined = args.join(" ");
                    if (args.length > 0) {
                        if (joined == "all") {
                            this.omegga.whisper(user, yellow("<b>List of all teleporters</b>"));
                            writeTeleportList(this.tps);
                        } else {
                            this.omegga.whisper(user, yellow("<b>List of teleporters by user " + cyan(joined) + "</>"));
                            writeTeleportList(this.tps.filter((tp) => tp.owner.toLowerCase() == joined.toLowerCase()));
                        }

                        return;
                    }

                    // list existing tps
                    this.omegga.whisper(user, yellow("<b>List of your teleporters</>"));
                    writeTeleportList(this.tps.filter((tp) => tp.owner == user));
                } else if (subcommand == "ignore") {
                    if (!authed) return;

                    const pData = this.getOrCreatePlayerData(user);
                    pData.ignore = !pData.ignore;

                    this.omegga.whisper(user, `<color="ff0">You will ${pData.ignore ? "no longer" : "now"} interact with teleports. Run the command again to toggle.</>`);
                } else if (subcommand == "create" || subcommand == "new") {
                    if (!this.userCanMakeTps(user)) {
                        this.omegga.whisper(user, red("You do not have permission to create teleports."));
                        return;
                    }

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
                    this.omegga.whisper(user, yellow("Is this teleporter one-way? One-way teleporters can only be entered from one way, and cannot be exited through the second point. Chat <code>yes</> or <code>no.</>"));
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

                        this.addTp({name, shape, positions: [pointA, pointB], radius, oneWay, safe, owner: user});
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

                        const tp = {name, shape, positions, sizes: [sizeA, sizeB], oneWay, safe, owner: user};
                        console.log(JSON.stringify(tp));
                        this.addTp(tp);
                        this.omegga.whisper(user, cyan(`The teleporter ${name} has been created!`));
                    }
                } else if (subcommand == "modify" || subcommand == "edit") {
                    if (!this.userCanMakeTps(user)) {
                        this.omegga.whisper(user, red("You do not have permission to edit teleports."));
                        return;
                    }

                    // get a name
                    this.omegga.whisper(user, yellow("Please enter the name of the teleporter you want to edit."));
                    let tp;
                    while (true) {
                        const nameSpecified = await this.getPlayerChatMessage(user);
                        const matched = this.tps.filter((tp) => tp.name.toLowerCase() == nameSpecified.toLowerCase());
                        if (matched.length > 0) {
                            tp = matched[0];
                            break;
                        } else {
                            this.omegga.whisper(user, red("No teleporter exists by that name. Please choose a valid teleporter name. If needed, locate its name with <code>/tps list</> or <code>/tps find</>."));
                        }
                    }

                    if (!authed && tp.owner != user) {
                        this.omegga.whisper(user, red("You are not authorized to edit that teleporter."));
                        return;
                    }

                    // get the property we want to edit
                    const validProperties = ["name", "zone 1", "zone 2", "one way", "safe"];
                    if (tp.shape == "sphere") validProperties.push("radius");

                    this.omegga.whisper(user, yellow("Enter the property of the teleporter you want to change."));
                    this.omegga.whisper(user, white("You must enter one of the following properties:"));
                    this.omegga.whisper(user, validProperties.map((p) => gray(p)).join(", "));
                    let property;
                    while (true) {
                        const propSpecified = await this.getPlayerChatMessage(user);
                        if (validProperties.includes(propSpecified.toLowerCase())) {
                            property = propSpecified.toLowerCase();
                            break;
                        } else {
                            this.omegga.whisper(user, red("Please enter a valid property of the teleporter. The following properties are:"));
                            this.omegga.whisper(user, validProperties.map((p) => gray(p)).join(", "));
                        }
                    }

                    if (property == "name") {
                        this.omegga.whisper(user, yellow("Enter the new name for this teleporter."));
                        let newName;
                        while (true) {
                            const nameSpecified = await this.getPlayerChatMessage(user);
                            if (nameSpecified.toLowerCase() == tp.name.toLowerCase()) {
                                this.omegga.whisper(user, white("No change was made as the name passed was the same as the original."));
                                return;
                            } else if (this.tps.some((t) => t.name.toLowerCase() == nameSpecified.toLowerCase())) {
                                this.omegga.whisper(user, red("A teleporter by that name already exists. Please choose a different name."));
                            } else {
                                newName = nameSpecified;
                                break;
                            }
                        }

                        const oldName = tp.name;
                        tp.name = newName;
                        await this.store.delete(`tp_${oldName}`);
                        await this.store.set(`tp_${newName}`, tp);
                        this.omegga.whisper(user, yellow(`The teleporter <b>${oldName}</>'s name has been changed to <b>${newName}</>.`));
                    } else if (property.startsWith("zone ")) {
                        const zoneNum = parseInt(property.substring(5)) - 1;
                        if (isNaN(zoneNum)) {
                            this.omegga.whisper(user, red(`Invalid zone number. Please enter zone 1 or 2. Modification cancelled.`));
                            return;
                        }

                        if (tp.shape == "sphere") {
                            this.omegga.whisper(user, yellow("Move to the point you'd like to change this zone to. When you are ready, chat <code>here</>."));
                            let newPos;
                            while (true) {
                                const confirmation = await this.getPlayerChatMessage(user);
                                if (confirmation == "done") {
                                    newPos = await player.getPosition();
                                    break;
                                } else {
                                    this.omegga.whisper(user, red("Please chat <code>done</> when you are in position to replace this zone center."));
                                }
                            }

                            tp.positions[zoneNum] = newPos;
                            await this.store.set(`tp_${tp.name}`, tp);
                            this.omegga.whisper(user, yellow(`The teleporter's zone ${zoneNum + 1} was changed to your location.`));
                        } else if (tp.shape == "prism") {
                            this.omegga.whisper(user, yellow("Select and copy some bricks using the selector to redefine the teleport zone. When you are done, chat <code>done</>."));
                            let newBounds;
                            while (true) {
                                const confirmation = await this.getPlayerChatMessage(user);
                                const bounds = await player.getTemplateBounds();
                                if (confirmation == "done") {
                                    if (bounds == null) {
                                        this.omegga.whisper(user, red("Please copy a selection of bricks to your clipboard by using the selector and using CTRL+C, then try again by chatting <code>done</>."));
                                    } else {
                                        newBounds = bounds;
                                        break;
                                    }
                                } else {
                                    this.omegga.whisper(user, red("Please chat <code>done</> when you are in position to replace this zone center."));
                                }
                            }

                            tp.positions[zoneNum] = newBounds.center;
                            tp.sizes[zoneNum] = [newBounds.maxBound[0] - newBounds.center[0], newBounds.maxBound[1] - newBounds.center[1], newBounds.maxBound[2] - newBounds.center[2]];
                            await this.store.set(`tp_${tp.name}`, tp);
                            this.omegga.whisper(user, yellow(`The teleporter's zone ${zoneNum + 1} was changed to your selection.`));
                        }
                    } else if (property == "one way") {
                        this.omegga.whisper(user, yellow("Would you like to make this teleporter one-way? One-way teleporters can only be entered from one way, and cannot be exited through the second point. Chat <code>yes</> or <code>no.</>"));
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
                                this.omegga.whisper(user, red("Please choose <code>yes</> or <code>no</>. Make the teleporter one-way?"));
                            }
                        }

                        tp.oneWay = oneWay;
                        await this.store.set(`tp_${tp.name}`, tp);
                        this.omegga.whisper(user, yellow(`The teleporter was changed to be ${tp.oneWay ? red("one-way") : cyan("both ways")}.`));
                    } else if (property == "safe") {
                        this.omegga.whisper(user, yellow("Change this teleporter to use safe teleporting? Respond with <code>yes</> or <code>no</>."));
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
                                this.omegga.whisper(user, red("Please choose <code>yes</> or <code>no</>. Make teleporter safe?"));
                            }
                        }

                        tp.safe = safe;
                        await this.store.set(`tp_${tp.name}`, tp);
                        this.omegga.whisper(user, yellow(`The teleporter was changed to use ${tp.safe ? green("safe") : cyan("normal")} teleporting.`));
                    }
                } else if (subcommand == "delete" || subcommand == "remove") {
                    // remove a tp
                    if (args.length > 0) {
                        const passedName = args.join(" ");

                        let foundTp;
                        this.tps.forEach((tp) => {
                            if (tp.name.toLowerCase() == passedName.toLowerCase()) {
                                foundTp = tp;
                            }
                        });

                        if (foundTp) {
                            if (!authed && foundTp.owner != user) {
                                this.omegga.whisper(user, red("You cannot remove someone else's teleporter."));
                                return;
                            }

                            await this.removeTp(foundTp);
                            this.omegga.whisper(user, yellow(`Teleporter <b>${foundTp.name}</> was removed.`));
                        } else {
                            this.omegga.whisper(user, red("Unable to find a teleporter by that name."));
                        }
                        return;
                    }

                    const pos = new Vector3(...(await Omegga.getPlayer(user).getPosition()));
                    let tpIn;
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
                    });

                    if (tpIn != null) {
                        if (!authed && tpIn.owner != user) {
                            this.omegga.whisper(user, red("You cannot remove someone else's teleporter."));
                            return;
                        }

                        await this.removeTp(tpIn);
                        this.omegga.whisper(user, yellow(`Teleporter <b>${tp.name}</> was removed.`));
                    } else this.omegga.whisper(user, red("Stand in a teleporter zone to remove it. You may need to use <code>/tps ignore</> to prevent being teleported."));
                } else if (subcommand == "find") {
                    const pos = new Vector3(...(await player.getPosition()));
                    
                    const getPosDistance = (tpPos) => {
                        return pos.subtract(new Vector3(...tpPos)).magnitude();
                    };
                    const getTpDistance = (tp) => Math.min(getPosDistance(tp.positions[0]), getPosDistance(tp.positions[1]));

                    const sortedTps = [...this.tps].sort((a, b) => getTpDistance(a) - getTpDistance(b));
                    if (sortedTps.length == 0) {
                        this.omegga.whisper(user, red("No teleporters could be found."));
                    } else {
                        const nearest = sortedTps[0];
                        const dist = Math.round(getTpDistance(nearest) * 10) / 100;
                        this.omegga.whisper(user, "Nearest teleporter: " + yellow(nearest.name) + " by " + cyan(nearest.owner || "no owner"));
                        this.omegga.whisper(user, white(`${nearest.shape}, ${nearest.oneWay ? red("one-way") : cyan("both ways")}, ${nearest.safe ? green("safe") : cyan("normal")} teleporting`));
                        this.omegga.whisper(user, gray("Distance: ") + white(dist.toString()));
                    }
                } else if (subcommand == "clearfor") {
                    if (!authed) return;

                    const filtered = this.tps.filter((tp) => tp.owner.toLowerCase() == args.join(" ").toLowerCase());
                    if (filtered == 0) this.omegga.whisper(user, red("Couldn't find any teleporters belonging to that user."));
                    else {
                        await Promise.all(filtered.map(async (f) => await this.removeTp(f)));
                        this.omegga.whisper(user, yellow(`Cleared <b>${args.join(" ")}</>'s ${filtered.length} teleporters.`));
                    }
                } else if (subcommand == "ban") {
                    if (!authed) return;

                    const name = args.join(" ");
                    await this.banUser(name);
                    this.omegga.broadcast(yellow(`User <b>${name}</> has been banned from creating teleports.`));
                } else if (subcommand == "unban") {
                    if (!authed) return;

                    const name = args.join(" ");
                    await this.unbanUser(name);
                    this.omegga.broadcast(yellow(`User <b>${name}</> has been unbanned from creating teleports.`));
                } else if (subcommand == "bans") {
                    if (!authed) return;

                    this.omegga.whisper(user, yellow("<b>List of banned users</b>"));
                    this.omegga.whisper(user, this.bans.map((b) => gray(b)).join(", "));
                    this.omegga.whisper(user, white("Ban with <code>/tps ban username</>, unban with <code>/tps unban username</>."));
                } else if (subcommand == "shiftall") { // kind of a debug-ish command
                    if (!authed) return;

                    const by = parseInt(args[0]);
                    this.tps.forEach(async (tp) => {
                        tp.positions[0][2] += by;
                        tp.positions[1][2] += by;
                        await this.store.set(`tp_${tp.name}`, tp);
                    });

                    this.omegga.whisper(user, yellow(`Shifted all teleporters by ${by} units.`));
                } else if (subcommand == "save") {
                    if (!authed) return;

                    const saveName = args.join(" ");
                    const save = {name: saveName, creator: user, at: Date.now(), tps: []};

                    // add all tps
                    this.tps.forEach((tp) => save.tps.push(tp));

                    // serialize it
                    const serializedSave = JSON.stringify(save);

                    // write it out
                    const path = saveName.endsWith(".json") ? saveName : `${saveName}.json`;
                    await fs.promises.writeFile(path, serializedSave);
                    this.omegga.whisper(user, yellow(`Saved teleporters to <code>${path}</>. Load at any time with <code>/tps load ${saveName}</>.`));
                } else if (subcommand == "load") {
                    if (!authed) return;

                    this.omegga.whisper(user, red("<b>Warning:</> This will wipe all existing teleporters. If needed, save them with <code>/tps save [name]</> first."));
                    this.omegga.whisper(user, white(`If you would like to proceed, chat ${green("yes")}.`));
                    const confirmation = await this.getPlayerChatMessage(user);
                    if (confirmation.toLowerCase() != "yes") {
                        this.omegga.whisper(user, yellow("Load cancelled, expected <code>yes</>."));
                        return;
                    }

                    const saveName = args.join(" ");
                    const path = saveName.endsWith(".json") ? saveName : `${saveName}.json`;
                    try {
                        await fs.promises.access(path, fs.constants.F_OK);
                    } catch (e) {
                        this.omegga.whisper(user, red("Unable to find a file by that name. Check your server directory, then try again."));
                        return;
                    }

                    const serializedSave = await fs.promises.readFile(path);
                    const save = JSON.parse(serializedSave.toString());

                    // wipe/reset current db
                    await this.store.set("tps", save.tps.map((tp) => tp.name));
                    const dbKeys = await this.store.keys();
                    await Promise.all(dbKeys.map(async (key) => {
                        if (key.startsWith("tp_"))
                            await this.store.delete(key);
                    }));
                    await Promise.all(save.tps.map(async (tp) => {
                        await this.store.set(`tp_${tp.name}`, tp);
                    }));
                    this.tps = [...save.tps];

                    this.omegga.whisper(user, white(`Loaded save ${yellow(save.name)}, saved by ${cyan(save.creator)} with ${yellow(`${save.tps.length} teleporters`)}.`));
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
