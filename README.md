# omegga-teleports

Create teleporters (two zones) that players will teleport between. Seamless relative positioning, configurable one or two-way teleports,
multiple zone shapes, named teleporters, etc.

This plugin is (sort of) a WIP. It is in a stable state, but there will likely be bugs or issues with teleporting. Use with (somewhat) caution.

## Installation

`omegga install gh:voximity/teleports`

## Usage

- `/tps`: View the teleporter commands. Use to view *all* commands.
- `/tps list`: View a list of teleporters.
- `/tps create`: Create a new teleporter. An interactive chat-based guide will help you create a new teleporter.
- `/tps remove [name]`: Remove a new teleporter by its name or by standing in it.
- `/tps ignore`: Toggle ignoring teleporters. You will be unaffected by all teleporters until you run the command again.
- `/tps find`: Display the name, owner, properties, and distance of the nearest teleporter.
- `/tps clearfor <user>`: Clear all teleporters for the passed user.
- `/tps modify`: Modify a teleporter.
- `/tps ban <user>`: Ban a user from creating teleporters.
- `/tps unban <user>`: Unban a user from creating teleporters.
- `/tps bans`: View a list of teleporter bans.
- `/tps save <save-name>`: Save teleporters to a named file.
- `/tps load <save-name>`: Load teleporters from a named file, overwriting existing ones.

## Credits

voximity - creator, maintainer

cake - Omegga

Kaje - original plugin idea
