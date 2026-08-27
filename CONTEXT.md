# slavshik.me

A one-page personal site with a television on it. The page is the primary
subject: a name, a line about the person, four links. The Television is
decoration that behaves like an object — it hangs, it falls, it can be pushed
around — and it must never be the reason the page fails to work.

## Language

### The page

**Accent**:
The single colour that varies with the visitor's local clock, through four
phases: dawn, day, sunset, night. The only part of the page that changes on
its own.
_Avoid_: highlight, brand colour, primary colour

**Theme**:
Light or dark. Follows the visitor's system preference unless a Theme
override is in force.
_Avoid_: colour scheme, mode

**Theme override**:
An explicit light-or-dark choice made on the page that supersedes the system
preference. Choosing the value the system already reports clears the override
rather than pinning it.
_Avoid_: theme setting, preference, forced theme

**Stage**:
The area of the page the Television occupies. Present whether or not a
Television is ever built in it.
_Avoid_: canvas, container, viewport

**Frozen mode**:
The page rendering with all motion and all randomness forbidden, so that one
commit always produces one image. Exists for screenshot tests. Independent of
whether the Television is shown at all.
_Avoid_: test mode, static mode, AQA mode, headless mode

### The Television

**Television**:
The CRT set at the top of the page. One object with a body, a screen, antennae,
feet, a Rope and a Plug.
_Avoid_: TV set, telly, box, model, the 3D thing

**Rope**:
The flex hanging from the back of the Television, ending in the Plug. Swings
under its own weight and drags on the Television's movement.
_Avoid_: cable, wire, cord, chain

**Plug**:
The weighted end of the Rope.
_Avoid_: connector, jack

**Anchor**:
The point on the Television's body where the Rope is attached. Moves when the
Television tilts, which is what makes the Rope swing on tilt alone.
_Avoid_: attachment point, mount point, pivot

**Home**:
The resting place the Television returns to when nothing is acting on it.
_Avoid_: origin, default position, rest position

**Drop**:
The Television's entrance: it falls into Home from above on first load.
_Avoid_: intro, entry animation

**Grounded**:
The Television is in contact with the floor.
_Avoid_: landed, resting, settled

**Sleeping**:
The Television has come to rest and its motion is no longer being computed.
Ends the moment anything acts on it.
_Avoid_: idle, paused, parked, asleep

**Palette**:
The set of colours the Television takes from the page, so that the object
agrees with the Theme and the Accent instead of carrying its own colours.
_Avoid_: colours, theme colours, material colours

**Look**:
The Television's shape, materials and lighting — everything about how it looks,
as opposed to how it behaves. Lives as numbers in one spec, which the cabinet
and the lights are built from.
_Avoid_: style, appearance, design, geometry, the mesh

**Snow**:
The white noise on the Television's screen. The screen shows nothing else.
_Avoid_: static, noise, signal, picture

**Flash**:
A brief brightening of the Snow when the Television is struck or thrown.
_Avoid_: pulse, blink, glow spike

**Roll**:
The picture slipping vertically, as on a set with an unstable vertical hold.
Happens on its own at irregular intervals.
_Avoid_: glitch, jitter, tear, distortion

### Tooling

**Lab**:
The workbench page for the Television: every constant exposed as a control,
with telemetry. Always drives the same Television source the site does, never
a copy.
_Avoid_: playground, sandbox, demo, workbench

**Look Lab**:
The Lab for the Look. Does not mount the Television — no physics, no input, no
broadcast — so the Television can be orbited and its Look tuned on its own.
_Avoid_: model viewer, 3D editor, preview
