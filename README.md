# Quantum Relativity Cosmos

> An interactive real-time astrophysics sandbox simulating N-body orbital gravity, general relativistic corrections, gravitational-wave inspirals, black hole mergers, Hawking radiation, and celestial atmosphere dynamics.

[![React 19](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)](https://vitejs.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-CSS%20v4-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Table of Contents
1. [Overview](#overview)
2. [Physics & Astrophysics Engine](#physics--astrophysics-engine)
3. [Visual & Rendering Architecture](#visual--rendering-architecture)
4. [Generative Audio System](#generative-audio-system)
5. [Interactive Controls & Tools](#interactive-controls--tools)
6. [Celestial Forge (Custom Body Designer)](#celestial-forge-custom-body-designer)
7. [Presets & Scenarios](#presets--scenarios)
8. [Saving, Sharing & Account Management](#saving-sharing--account-management)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [Local Development & Setup](#local-development--setup)
11. [Project Structure](#project-structure)
12. [License](#license)

---

## Overview

**Quantum·Relativity Cosmos** blends orbital celestial mechanics with quantum and general relativistic phenomena into an interactive, real-time web sandbox. Build solar systems from scratch, throw rogue black holes into stable multi-star systems, or watch compact binaries radiate gravitational waves until they collide and emit space-warping ripples.

The simulation runs in a decoupled physics loop with 60 FPS Canvas 2D and WebGL rendering, complete with relativistic optical effects, real-time trajectory projections, and generative spatial audio.

---

## Physics & Astrophysics Engine

The physics simulation core lives in pure TypeScript (`src/cosmos/physics.ts`) without UI or DOM dependencies, allowing full deterministic testing.

### 1. Symplectic RK4 N-Body Gravitation
- **Runge-Kutta 4th Order (RK4)** numerical integration ensures high-precision orbital conservation over thousands of simulation steps.
- **Plummer softening** eliminates infinite gravitational singularity anomalies during near-miss flybys.

### 2. General Relativistic Corrections (Post-Newtonian Approximations)
- **Perihelion Precession:** Accurate Einsteinian orbital shifts for tight periastron passes (such as Mercury-like or relativistic orbits).
- **Frame Dragging (Lense-Thirring Effect):** Spinning Kerr black holes perturb nearby orbital inclinations.
- **Lorentz Contraction & Time Dilation:** Bodies approaching the speed of light exhibit length contraction and velocity-dependent visual shifts.

### 3. Gravitational Wave (GW) Inspiral & Mergers
- **Peters-Mathews GW Radiation Loss:** Compact binary systems (black holes and neutron stars) continuously lose orbital energy and angular momentum.
- **Violent Mergers:** When event horizons touch, they coalesce into a single remnant mass with momentum-conserved recoil velocity (kick) while generating expanding spacetime metric ripples.

### 4. Hawking Radiation & Black Hole Evaporation
- Sub-stellar and micro black holes radiate energy inversely proportional to their squared mass, accelerating in luminosity as they evaporate into vacuum.

### 5. Stellar Winds & Atmospheric Stripping
- Host stars emit high-energy solar wind and radiation pressure.
- Planets orbiting too close to luminous stars without sufficient planetary magnetic shielding experience gradual atmosphere stripping down to bare rocky cores.

### 6. Relativistic Doppler Shifting & Beaming
- Celestial bodies and accretion disks moving toward the observer are Doppler-shifted into higher frequency blue-white spectra, while receding sides shift to dim red spectra.

---

## Visual & Rendering Architecture

A dual-engine rendering pipeline maximizes visual fidelity and frame rate across desktop and mobile:

- **GPU WebGL Backdrop (`gl-backdrop.ts`):** 
  - Procedural multi-frequency Perlin nebula clouds.
  - Parallax starfield with spectral temperature coloration.
  - Real-time chromatic aberration shaders during massive gravitational collisions.
- **Precision Canvas 2D Compositor (`render.ts`):**
  - **Dynamic Spacetime Mesh:** 2D grid showing gravitational potential wells, warped by massive bodies and rippling under gravitational waves.
  - **Relativistic Accretion Disks:** Realistic optical asymmetry (beaming and blue-shift on the approaching side, redshift on the receding side).
  - **Orbital Trails & Tangent Vectors:** Color-coded velocity arrows and fading orbital path histories.
  - **Raycasted Planetary Shadows & Atmospheres:** Day/night terminators, atmospheric scatter rings, and planetary shadow cones cast across rings and moons.
  - **Adaptive Quality Controller:** Dynamically scales nebula resolution steps and device pixel ratio (DPR) to maintain stable 60 FPS on lower-power devices.

---

## Generative Audio System

Built with the browser **Web Audio API** (`src/cosmos/audio.ts`):
- **Deep Spacetime Drone:** Dual low-frequency detuned oscillators running through a multi-pole low-pass filter modulated by total system gravitational curvature.
- **Harmonic Chimes:** Algorithmic celestial chimes triggered when bodies reach periapsis (closest approach) or complete full orbits.
- **Collision & Merger Impacts:** Sub-bass rumble and high-reverb transient shockwaves whenever cosmic bodies collide or coalesce.

---

## Interactive Controls & Tools

### Bottom Control Dock
- **Select Tool (`1`):** Click any body to focus, view real-time orbital telemetry, or drag to reposition.
- **Planet Tool (`2`):** Click and drag anywhere in space to sling a planet with initial velocity. The trajectory line visualizes the initial orbit before release.
- **Star Tool (`3`):** Place fusion-burning stellar hosts.
- **Black Hole Tool (`4`):** Spawn event horizons with accretion disks.
- **Design Planet (Hammer):** Opens the **Celestial Forge** to configure or edit celestial properties.
- **Physics Parameters (Atom):** Tune global gravitational constant ($G$), speed of light ($c$), simulation tick speed, collision behaviors, and relativistic acceleration factors.
- **Post-Processing (Sparkles):** Toggle spacetime grid, orbital trails, velocity vectors, velocity labels, and audio drones.
- **Time Controls:** Real-time playback slider ($0.1\times$ to $5\times$), Play/Pause, and single-step forward.

### Target Tracking HUD
When selecting any body:
- **Lock Camera (`L`):** Locks viewport center to follow the targeted body through space.
- **Live Telemetry:** Instantaneous velocity ($km/s$), current mass, orbital radius, and eccentricity.
- **Edit in Forge:** Push body parameters into the Forge for real-time modification.
- **Delete (`Del`):** Remove body from spacetime.

---

## Celestial Forge (Custom Body Designer)

The Celestial Forge allows fine-grained customization of planetary and stellar parameters:

| Parameter | Options / Description |
| :--- | :--- |
| **Body Classification** | Planet, Star, or Black Hole |
| **Composition** | Rocky, Gas Giant, Ice World, Lava, Iron, Waterworld |
| **Mass & Radius** | Calibrated in Earth Masses ($M_\oplus$) or Solar Masses ($M_\odot$) |
| **Atmosphere** | Custom density slider and hex color tint |
| **Planetary Rings** | Adjustable inner radius, outer span, opacity, and tilt |
| **Magnetic Field** | Dipole strength slider (protects against solar wind atmospheric loss) |
| **Black Hole Spin** | Kerr spin parameter controlling accretion disk rotation speed |

---

## Presets & Scenarios

The simulator includes curated astrophysical setups accessible via the top-left dropdown:

1. **Helios System:** A central sun with six diverse worlds (rocky, ringed gas giant, ice world) and a distant rogue singularity.
2. **Binary Inspiral:** Two equal-mass black holes in a tight relativistic dance radiating gravitational waves until merger.
3. **Twin Suns:** A circumbinary planetary system exhibiting complex multi-star gravitational perturbations.
4. **Empty Void:** An empty vacuum ready for custom celestial configurations.

---

## Saving, Sharing & Account Management

### Public Share Links
- Save any custom universe to generate a permanent, shareable URL.
- Anyone can open and explore public share links without needing an account.

### Account Features
- **Sign In / Sign Up:** Email & password authentication with password-reset flows, or one-click Google OAuth.
- **My Universes:** Synced cloud dashboard listing all your creations.
- **Ownership Security:** Only the verified creator of a universe can rename, overwrite, or delete it; guests can duplicate or explore.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Pause / Resume simulation |
| <kbd>1</kbd> | Selection / Inspection tool |
| <kbd>2</kbd> | Spawn Planet (click & drag to sling) |
| <kbd>3</kbd> | Spawn Star |
| <kbd>4</kbd> | Spawn Black Hole |
| <kbd>L</kbd> | Lock / Unlock camera tracking on selected body |
| <kbd>+</kbd> / <kbd>=</kbd> | Zoom in |
| <kbd>-</kbd> | Zoom out |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selected body |
| <kbd>Esc</kbd> | Deselect body and close open panels |

---

## Local Development & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/) (v1.1+)

### Installation
```bash
# Clone repository
git clone https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
cd <YOUR_REPO_NAME>

# Install dependencies
bun install
# or: npm install
