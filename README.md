# Obsidian VTT

This project is a plugin for [Obsidian](https://obsidian.md). 

The purpose of this plugin is to implement a simple Virtual Tabletop (VTT) within Obsidian.

## Why this plugin?

First, I am a solo roleplayer who loves to use Obsidian VTT to manage game rules, record world lore, keep session notes, and store character details. Obsidian is a wonderful tool for connecting the different aspects of a game world.

Next, while there are a lot of VTTs out there, many of them include features that are not really necessary for solo roleplay -- things like networking, advanced lighting, fog of war, and so on.

In addition, while there is some integration between VTTs (like Foundry) and Obsidian, there is no tight integration that favors an "Obsidian-first" approach.

So, I decided to create a plugin to fill that specific niche.

## Features

- Seamless integration with Obsidian: Install, enable, go
- Simple map format (`.vttmap`): Maps are saved in human-readable JSON
- System-agnostic game board: The user brings the rules
- Bring your own assets: Just drag-and-drop them into a scene
	- Support for 4 asset types: backgrounds, prefabs, objects, and tokens
	- Note that prefabs are intended for more complex assets (like buildings with roofs) -- features to use these capabilities will be introduced later
- No arbitrary limit on map size
- Lightweight but "typical" VTT experience featuring:
	- Configurable grid size
	- Easily manage asset position, rotation, and resizing
	- Easily lock static assets
	- Snap assets to the grid
	- Simple measurement tool with logic for typical diagonal measurement schemes
	- Simple dice rolling
	- Sane defaults configured via Obsidian's Settings UI
	- Map-configurable settings for flexibility

## Possible Future Features

- Hex grids:
	- Hex snap
	- Hex movement
	- Rotation per hex facing
	- Hex resize (tricky!)
- Drawing layer (pen drawings, primitive shapes, text, colors)
- Integration between assets and Obsidian notes
	- Examples: Click a character token, see it's sheet; click a monster, see its description
	- Requires: New asset type (not a prefab, more than a token...)
	- Perhaps document front-matter could define this (asset name, icon reference) and the VTT could scan for it?
- Map generation tools
	- Wilderness by biome
	- Dungeons
	- Caves / caverns
	- Urban types
	- More
- New asset types:
	- Tiles
		- Grid painting?
    - Effects
    	- Magic, fire, weather...
- Prefab levels (removeable roofs, removeable tree tops, etc)
- Teleporter
	- Exampke: Place different floors of a tower on the same map; jump tokens from level to level at a staircase, etc.
- Walls and doors
	- Barriers to movement?
	- Barriers to light?
	- Door open/close/lock state
- Animated maps, animated objects (eye candy)
- Shadows?
- Lighting: not for fog of war, just for effect
- Extensions (other plugins). Example ideas:
	- Character sheets for different systems
	- Encounter tools
	- Initiative tracker
