/**
 * ============================================================================
 * 3D CINEMATIC WEATHER ENGINE (Three.js & WebGL GPU Fragment Shaders)
 * Client-Side GPU-Accelerated Weather Simulation & Real-time Open-Meteo Sync
 * ============================================================================
 */

(function () {
    'use strict';

    // Verify Three.js Availability
    function isThreeAvailable() {
        return typeof THREE !== 'undefined' && typeof THREE.WebGLRenderer === 'function';
    }

    // Detect WebGL Support
    function isWebGLSupported() {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    // Preset Cities & Global Coordinates for Open-Meteo API
    const WEATHER_LOCATIONS = {
        hanoi: { name: 'Hà Nội, Vietnam', lat: 21.0285, lon: 105.8542, icon: '🇻🇳', defaultPreset: 'tokyo_rain' },
        hcmc: { name: 'TP. Hồ Chí Minh, Vietnam', lat: 10.8231, lon: 106.6297, icon: '🇻🇳', defaultPreset: 'tokyo_rain' },
        tokyo: { name: 'Tokyo, Japan (Cyber City)', lat: 35.6762, lon: 139.6503, icon: '🇯🇵', defaultPreset: 'tokyo_rain' },
        tromso: { name: 'Tromsø, Norway (Arctic Aurora)', lat: 69.6492, lon: 18.9553, icon: '🇳🇴', defaultPreset: 'tromso_aurora' },
        alps: { name: 'Swiss Alps, Switzerland (Blizzard)', lat: 46.5590, lon: 8.5606, icon: '🇨🇭', defaultPreset: 'swiss_snow' },
        atacama: { name: 'Atacama Desert, Chile (Deep Space)', lat: -23.8634, lon: -69.1328, icon: '🇨🇱', defaultPreset: 'atacama_galaxy' },
        london: { name: 'London, United Kingdom (Mist & Rain)', lat: 51.5074, lon: -0.1278, icon: '🇬🇧', defaultPreset: 'tokyo_rain' },
        newyork: { name: 'New York, USA (Metropolis Rain)', lat: 40.7128, lon: -74.0060, icon: '🇺🇸', defaultPreset: 'tokyo_rain' }
    };

    // =========================================================================
    // GLSL SHADERS LIBRARY (Custom GPU Vertex & Fragment Shaders)
    // =========================================================================
    const SHADERS = {
        // --- 1. Tokyo Cyber Rain Shader ---
        rainVertex: `
            attribute float aSpeed;
            attribute float aLength;
            attribute vec3 aColor;
            attribute float aAlpha;

            uniform float uTime;
            uniform float uWindForce;
            uniform float uFallSpeed;
            uniform float uHeightRange;

            varying vec3 vColor;
            varying float vAlpha;

            void main() {
                vColor = aColor;
                vAlpha = aAlpha;

                vec3 pos = position;
                // Animate Y position with wrap-around
                float fallDist = uTime * aSpeed * uFallSpeed * 28.0;
                pos.y = mod(position.y - fallDist, uHeightRange) - (uHeightRange * 0.5);
                
                // Wind shear along X/Z
                pos.x += sin(pos.y * 0.05 + uTime * 2.0) * 0.3 + (uWindForce * 0.4 * (position.y + 20.0));
                pos.z += cos(pos.y * 0.03 + uTime) * 0.2;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                
                // Scale point by perspective depth
                gl_PointSize = (aLength * (220.0 / -mvPosition.z));
            }
        `,
        rainFragment: `
            precision highp float;
            varying vec3 vColor;
            varying float vAlpha;

            void main() {
                // Render as elongated rain streak
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord * vec2(2.8, 0.4));
                if (dist > 0.5) discard;

                float streak = smoothstep(0.5, 0.0, dist);
                gl_FragColor = vec4(vColor, streak * vAlpha);
            }
        `,

        // --- 2. Ground Neon Puddle Ripple Shader ---
        rippleVertex: `
            varying vec2 vUv;
            varying vec3 vWorldPosition;

            void main() {
                vUv = uv;
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        rippleFragment: `
            precision highp float;
            uniform float uTime;
            uniform vec3 uNeonColor1;
            uniform vec3 uNeonColor2;
            uniform float uRippleIntensity;
            
            varying vec2 vUv;
            varying vec3 vWorldPosition;

            // Simplex noise approximation
            vec3 hash33(vec3 p3) {
                p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yxz + 33.33);
                return fract((p3.xxy + p3.yxx) * p3.zyx);
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float r = length(uv);
                
                // Multiple dynamic circular ripple centers
                float ripple = 0.0;
                for(int i = 0; i < 4; i++) {
                    float fi = float(i);
                    vec2 center = vec2(sin(fi * 2.3 + uTime * 0.7) * 0.6, cos(fi * 1.7 + uTime * 0.9) * 0.6);
                    float d = length(uv - center);
                    float wave = sin(d * 24.0 - uTime * 5.0 + fi) * exp(-d * 3.5);
                    ripple += wave * (0.25 / (1.0 + d * 2.0));
                }

                // Grid lines for cyber aesthetic
                vec2 grid = abs(fract(vUv * 28.0 - 0.5) - 0.5) / fwidth(vUv * 28.0);
                float line = min(grid.x, grid.y);
                float gridVal = 1.0 - min(line, 1.0);

                // Neon chromatic blend
                vec3 col = mix(uNeonColor1, uNeonColor2, sin(uTime * 0.8 + uv.x * 2.0) * 0.5 + 0.5);
                
                // Specular sheen & puddles reflection
                float alpha = clamp(0.15 + abs(ripple) * 0.45 * uRippleIntensity + gridVal * 0.12, 0.0, 0.85);
                float vignette = smoothstep(1.2, 0.2, r);
                
                gl_FragColor = vec4(col + vec3(ripple * 0.3), alpha * vignette);
            }
        `,

        // --- 3. Tromsø Volumetric Aurora Waves Shader ---
        auroraVertex: `
            uniform float uTime;
            uniform float uWaveSpeed;
            uniform float uWaveHeight;

            varying vec2 vUv;
            varying float vHeight;

            // Simplex noise implementation in GLSL
            vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
            vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

            float snoise(vec2 v){
                const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v -   i + dot(i, C.xx);
                vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod(i, 289.0);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m ;
                m = m*m ;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= taylorInvSqrt( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }

            void main() {
                vUv = uv;
                vec3 pos = position;
                
                // Multi-harmonic volumetric undulating wave
                float t = uTime * uWaveSpeed * 0.6;
                float noise1 = snoise(vec2(pos.x * 0.08 + t * 0.4, pos.y * 0.06));
                float noise2 = snoise(vec2(pos.x * 0.15 - t * 0.7, pos.z * 0.1 + t * 0.3));
                
                pos.z += (noise1 * 4.5 + noise2 * 2.2) * uWaveHeight * (1.0 - uv.y * 0.4);
                pos.x += sin(pos.y * 0.2 + t) * 1.5;

                vHeight = pos.y;
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        auroraFragment: `
            precision highp float;
            uniform float uTime;
            uniform float uBrightness;

            varying vec2 vUv;
            varying float vHeight;

            void main() {
                // Multi-spectral color palette for Arctic Aurora
                // Emerald Green -> Cyan Teal -> Violet -> Neon Magenta
                vec3 colGreen   = vec3(0.0, 1.0, 0.55);
                vec3 colTeal    = vec3(0.15, 0.85, 0.95);
                vec3 colViolet  = vec3(0.55, 0.2, 0.95);
                vec3 colMagenta = vec3(0.95, 0.2, 0.8);

                float y = clamp(vUv.y, 0.0, 1.0);
                
                // Color ramp across vertical curtain height
                vec3 color;
                if (y < 0.35) {
                    color = mix(colGreen, colTeal, y / 0.35);
                } else if (y < 0.75) {
                    color = mix(colTeal, colViolet, (y - 0.35) / 0.4);
                } else {
                    color = mix(colViolet, colMagenta, (y - 0.75) / 0.25);
                }

                // Vertical alpha curtain falloff & edge feathering
                float alphaBase = sin(y * 3.14159);
                float curtainStriae = sin(vUv.x * 45.0 + uTime * 2.0) * 0.15 + 0.85;
                float edgeFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                
                float alpha = alphaBase * curtainStriae * edgeFade * uBrightness * 0.82;
                
                gl_FragColor = vec4(color * (1.2 + sin(uTime * 1.5 + vUv.x * 10.0) * 0.3), alpha);
            }
        `,

        // --- 4. Swiss Alps Snowstorm Particle Shader (Depth of Field) ---
        snowVertex: `
            attribute float aSize;
            attribute float aSpeed;
            attribute float aPhase;
            attribute float aRotSpeed;

            uniform float uTime;
            uniform float uWindForce;
            uniform float uFallSpeed;
            uniform float uHeightRange;
            uniform float uCameraZ;

            varying float vAlpha;
            varying float vDepthBlur;
            varying float vRotation;

            void main() {
                vec3 pos = position;
                
                // Fall animation
                float fallDist = uTime * aSpeed * uFallSpeed * 7.5;
                pos.y = mod(position.y - fallDist, uHeightRange) - (uHeightRange * 0.5);
                
                // Swirling wind vortex
                float angle = uTime * aRotSpeed + aPhase;
                pos.x += sin(angle) * 1.2 + (uWindForce * 0.7 * (1.0 + sin(uTime * 0.5) * 0.3));
                pos.z += cos(angle) * 1.2;

                vRotation = angle;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mvPosition;

                // Depth of field calculation: near camera is larger and softly blurred
                float distToCam = -mvPosition.z;
                float dofFactor = abs(distToCam - 18.0) / 25.0;
                vDepthBlur = clamp(dofFactor, 0.0, 1.0);
                
                gl_PointSize = aSize * (1.0 + (1.0 - vDepthBlur) * 0.8) * (260.0 / distToCam);
                vAlpha = clamp(0.4 + (1.0 - vDepthBlur) * 0.6, 0.2, 0.95);
            }
        `,
        snowFragment: `
            precision highp float;
            varying float vAlpha;
            varying float vDepthBlur;
            varying float vRotation;

            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                
                // Rotated snowflake orientation
                float c = cos(vRotation);
                float s = sin(vRotation);
                vec2 rCoord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
                
                float dist = length(rCoord);
                if (dist > 0.5) discard;

                // Soft blurred radial edge for realistic snowflake bokeh
                float edge = mix(0.1, 0.45, vDepthBlur);
                float radial = smoothstep(0.5, edge, dist);
                
                // Ice crystal bright core
                float core = smoothstep(0.2, 0.0, dist) * 0.4;
                
                vec3 snowColor = vec3(0.92, 0.96, 1.0);
                gl_FragColor = vec4(snowColor + core, (radial + core) * vAlpha);
            }
        `,

        // --- 5. Atacama Deep Space Galaxy & Shooting Stars Shader ---
        starVertex: `
            attribute float aSize;
            attribute vec3 aColor;
            attribute float aTwinkleSpeed;
            attribute float aPhase;

            uniform float uTime;

            varying vec3 vColor;
            varying float vTwinkle;

            void main() {
                vColor = aColor;
                vTwinkle = sin(uTime * aTwinkleSpeed + aPhase) * 0.4 + 0.6;

                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = aSize * vTwinkle * (300.0 / -mvPosition.z);
            }
        `,
        starFragment: `
            precision highp float;
            varying vec3 vColor;
            varying float vTwinkle;

            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;

                // Glowing star diffraction core
                float radial = smoothstep(0.5, 0.0, dist);
                float spike = (smoothstep(0.08, 0.0, abs(coord.x)) * smoothstep(0.5, 0.0, abs(coord.y)) +
                               smoothstep(0.08, 0.0, abs(coord.y)) * smoothstep(0.5, 0.0, abs(coord.x))) * 0.4;

                gl_FragColor = vec4(vColor, (radial + spike) * vTwinkle);
            }
        `,

        // --- 6. Meteor / Shooting Star Line Shader ---
        meteorVertex: `
            attribute float aProgress;
            attribute float aAlpha;
            uniform float uProgress;

            varying float vAlpha;

            void main() {
                vAlpha = aAlpha;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        meteorFragment: `
            precision highp float;
            varying float vAlpha;

            void main() {
                gl_FragColor = vec4(1.0, 0.95, 0.8, vAlpha);
            }
        `
    };

    // =========================================================================
    // THREE.JS 3D CINEMATIC WEATHER ENGINE CLASS
    // =========================================================================
    class ThreeWeatherEngine {
        constructor() {
            this.container = null;
            this.canvas = null;
            this.scene = null;
            this.camera = null;
            this.renderer = null;
            this.clock = null;

            // Runtime State
            this.activePresetKey = 'tokyo_rain';
            this.currentLocationKey = 'tokyo';
            this.isRunning = false;
            this.isTabActive = true;
            this.animFrameId = null;
            this.fpsHistory = [];
            this.currentFps = 60;
            this.lastFrameTime = performance.now();
            this.frameCount = 0;

            // 3D Scene Mesh/Object Handles
            this.objects = {
                particles: null,
                groundPlane: null,
                auroraMesh: null,
                starfield: null,
                meteors: [],
                nebulaPlane: null,
                ambientLight: null
            };

            // Uniforms & Config
            this.uniforms = {
                uTime: { value: 0.0 },
                uWindForce: { value: 0.0 },
                uFallSpeed: { value: 1.0 },
                uParticleDensity: { value: 1.0 },
                uHeightRange: { value: 50.0 },
                uRippleIntensity: { value: 1.0 },
                uNeonColor1: { value: new THREE.Color(0x00f2fe) },
                uNeonColor2: { value: new THREE.Color(0xec4899) },
                uWaveSpeed: { value: 1.0 },
                uWaveHeight: { value: 1.0 },
                uBrightness: { value: 1.0 },
                uCameraZ: { value: 25.0 }
            };

            // Physics & Customization parameters
            this.params = {
                cameraDepth: 25.0,
                particleDensity: 2000,
                windForce: 0.0,
                fallSpeed: 1.0,
                glowIntensity: 1.0,
                autoRotateCamera: true
            };

            // Real-time Meteorological API Data Cache
            this.weatherData = {
                temperature: 24.5,
                windSpeed: 12.0,
                humidity: 78,
                weatherCode: 61,
                conditionText: 'Mưa rào nhẹ',
                cityLabel: 'Tokyo, Japan',
                lastUpdated: new Date()
            };
        }

        /**
         * Initialize the Three.js Viewport Engine
         */
        init(containerId = 'ws-canvas-wrapper', canvasId = 'ws-viewport-canvas') {
            if (!isThreeAvailable() || !isWebGLSupported()) {
                console.warn('[ThreeWeatherEngine] Three.js or WebGL not available. Falling back to standard 2D canvas.');
                return false;
            }

            this.container = document.getElementById(containerId) || 
                             document.querySelector('.ws-viewport-container') || 
                             document.getElementById('ws-canvas-wrapper');
            if (!this.container) return false;

            // Create or bind canvas element
            let existingCanvas = document.getElementById(canvasId) || 
                                 document.getElementById('ws-viewport-canvas') || 
                                 document.getElementById('ws-viewport-webgl-canvas');
            if (!existingCanvas) {
                existingCanvas = document.createElement('canvas');
                existingCanvas.id = canvasId;
                existingCanvas.className = 'ws-viewport-webgl-canvas';
                this.container.prepend(existingCanvas);
            }
            this.canvas = existingCanvas;

            // 1. Scene & Clock
            this.scene = new THREE.Scene();
            this.scene.fog = new THREE.FogExp2(0x0a0f1d, 0.015);
            this.clock = new THREE.Clock();

            // 2. Camera
            const rect = this.container.getBoundingClientRect();
            const width = Math.max(rect.width, 300);
            const height = Math.max(rect.height, 200);
            const aspect = width / height;

            this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
            this.camera.position.set(0, 4.0, this.params.cameraDepth);
            this.camera.lookAt(0, 2.0, 0);

            // 3. WebGL Renderer with High-Performance Settings
            try {
                this.renderer = new THREE.WebGLRenderer({
                    canvas: this.canvas,
                    alpha: true,
                    antialias: true,
                    powerPreference: 'high-performance',
                    stencil: false,
                    depth: true
                });
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                this.renderer.setSize(width, height);
                this.renderer.setClearColor(0x000000, 0);
            } catch (e) {
                console.error('[ThreeWeatherEngine] WebGLRenderer creation failed:', e);
                return false;
            }

            // 4. Ambient Lights
            this.objects.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
            this.scene.add(this.objects.ambientLight);

            // 5. Initial Preset Setup
            this.buildPreset(this.activePresetKey);

            // 6. Event Listeners
            this.bindResizeListener();

            // 7. Initial Fetch Real Weather
            this.fetchRealTimeWeather(this.currentLocationKey);

            // 8. Start Rendering Loop
            this.start();

            console.log('[ThreeWeatherEngine] 3D Cinematic Weather Engine initialized successfully.');
            return true;
        }

        /**
         * Resize Handler
         */
        bindResizeListener() {
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            if (!this.container || !this.renderer || !this.camera) return;
            const width = this.container.clientWidth || this.container.getBoundingClientRect().width || 800;
            const height = this.container.clientHeight || this.container.getBoundingClientRect().height || 500;

            if (width > 0 && height > 0) {
                this.camera.aspect = width / height;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(width, height);
            }
        }

        /**
         * Clear All Current 3D Meshes from Scene
         */
        clearScene() {
            if (!this.scene) return;

            const removeAndDispose = (obj) => {
                if (!obj) return;
                this.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            };

            removeAndDispose(this.objects.particles);
            removeAndDispose(this.objects.groundPlane);
            removeAndDispose(this.objects.auroraMesh);
            removeAndDispose(this.objects.starfield);
            removeAndDispose(this.objects.nebulaPlane);

            if (this.objects.meteors && this.objects.meteors.length) {
                this.objects.meteors.forEach(m => removeAndDispose(m.mesh));
                this.objects.meteors = [];
            }

            this.objects.particles = null;
            this.objects.groundPlane = null;
            this.objects.auroraMesh = null;
            this.objects.starfield = null;
            this.objects.nebulaPlane = null;
        }

        /**
         * Switch 3D Preset Scene
         */
        setPreset(presetKey) {
            this.activePresetKey = presetKey;
            this.clearScene();
            this.buildPreset(presetKey);
            this.updateHUDDisplay();
        }

        /**
         * Switch Real-time Weather Location
         */
        setLocation(locationKey) {
            if (WEATHER_LOCATIONS[locationKey]) {
                this.currentLocationKey = locationKey;
                const loc = WEATHER_LOCATIONS[locationKey];
                this.weatherData.cityLabel = loc.name;
                this.fetchRealTimeWeather(locationKey);
            }
        }

        /**
         * Build Preset Scene Geometry & Shaders
         */
        buildPreset(presetKey) {
            switch (presetKey) {
                case 'tokyo_rain':
                    this.buildTokyoCyberRain();
                    break;
                case 'tromso_aurora':
                    this.buildTromsoAurora();
                    break;
                case 'swiss_snow':
                    this.buildSwissSnowstorm();
                    break;
                case 'atacama_galaxy':
                    this.buildAtacamaGalaxy();
                    break;
                default:
                    this.buildTokyoCyberRain();
                    break;
            }
        }

        // =====================================================================
        // PRESET 1: Tokyo Cyber Rain & Puddle Ripple 3D
        // =====================================================================
        buildTokyoCyberRain() {
            const count = Math.round(this.params.particleDensity * 1.3);
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const speeds = new Float32Array(count);
            const lengths = new Float32Array(count);
            const alphas = new Float32Array(count);

            const palette = [
                new THREE.Color(0x00f2fe), // Cyan
                new THREE.Color(0x38bdf8), // Sky Blue
                new THREE.Color(0xec4899), // Neon Magenta
                new THREE.Color(0xa855f7)  // Purple
            ];

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                positions[i3] = (Math.random() - 0.5) * 60;
                positions[i3 + 1] = Math.random() * 50 - 10;
                positions[i3 + 2] = (Math.random() - 0.5) * 50;

                const col = palette[Math.floor(Math.random() * palette.length)];
                colors[i3] = col.r;
                colors[i3 + 1] = col.g;
                colors[i3 + 2] = col.b;

                speeds[i] = 0.8 + Math.random() * 0.7;
                lengths[i] = 1.2 + Math.random() * 2.2;
                alphas[i] = 0.4 + Math.random() * 0.6;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));
            geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

            const material = new THREE.ShaderMaterial({
                vertexShader: SHADERS.rainVertex,
                fragmentShader: SHADERS.rainFragment,
                uniforms: this.uniforms,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            this.objects.particles = new THREE.Points(geometry, material);
            this.scene.add(this.objects.particles);

            // Ground Ripple Mesh
            const planeGeo = new THREE.PlaneGeometry(75, 75, 40, 40);
            planeGeo.rotateX(-Math.PI / 2);
            planeGeo.translate(0, -6, 0);

            const rippleMat = new THREE.ShaderMaterial({
                vertexShader: SHADERS.rippleVertex,
                fragmentShader: SHADERS.rippleFragment,
                uniforms: this.uniforms,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            this.objects.groundPlane = new THREE.Mesh(planeGeo, rippleMat);
            this.scene.add(this.objects.groundPlane);
        }

        // =====================================================================
        // PRESET 2: Tromsø Aurora Volumetric Waves 3D
        // =====================================================================
        buildTromsoAurora() {
            // Multi-layered Curved Aurora Ribbons
            const ribbonGroup = new THREE.Group();
            const layersCount = 3;

            for (let i = 0; i < layersCount; i++) {
                const ribbonGeo = new THREE.PlaneGeometry(85, 28, 90, 24);
                ribbonGeo.translate(0, 8 + i * 2.5, -15 - i * 8);

                const auroraMat = new THREE.ShaderMaterial({
                    vertexShader: SHADERS.auroraVertex,
                    fragmentShader: SHADERS.auroraFragment,
                    uniforms: {
                        ...this.uniforms,
                        uWaveSpeed: { value: 0.8 + i * 0.3 },
                        uWaveHeight: { value: 1.2 + i * 0.4 },
                        uBrightness: { value: 0.9 - i * 0.15 }
                    },
                    transparent: true,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    blending: THREE.AdditiveBlending
                });

                const ribbonMesh = new THREE.Mesh(ribbonGeo, auroraMat);
                ribbonGroup.add(ribbonMesh);
            }

            this.objects.auroraMesh = ribbonGroup;
            this.scene.add(this.objects.auroraMesh);

            // Background Starfield for Arctic Night
            this.buildStarfield(1500, 70);
        }

        // =====================================================================
        // PRESET 3: Swiss Alps 3D Depth Snowstorm
        // =====================================================================
        buildSwissSnowstorm() {
            const count = Math.round(this.params.particleDensity * 1.5);
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const speeds = new Float32Array(count);
            const phases = new Float32Array(count);
            const rotSpeeds = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                positions[i3] = (Math.random() - 0.5) * 65;
                positions[i3 + 1] = Math.random() * 50 - 10;
                positions[i3 + 2] = (Math.random() - 0.5) * 55;

                sizes[i] = 1.5 + Math.random() * 3.5;
                speeds[i] = 0.5 + Math.random() * 0.9;
                phases[i] = Math.random() * Math.PI * 2;
                rotSpeeds[i] = (Math.random() - 0.5) * 2.0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
            geometry.setAttribute('aRotSpeed', new THREE.BufferAttribute(rotSpeeds, 1));

            const material = new THREE.ShaderMaterial({
                vertexShader: SHADERS.snowVertex,
                fragmentShader: SHADERS.snowFragment,
                uniforms: this.uniforms,
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending
            });

            this.objects.particles = new THREE.Points(geometry, material);
            this.scene.add(this.objects.particles);
        }

        // =====================================================================
        // PRESET 4: Atacama Deep Space Galaxy & Shooting Stars
        // =====================================================================
        buildAtacamaGalaxy() {
            // 1. Starfield
            this.buildStarfield(3500, 85);

            // 2. Shooting Stars / Meteors Array
            this.objects.meteors = [];
            for (let i = 0; i < 4; i++) {
                this.spawnMeteor();
            }
        }

        buildStarfield(count, radius) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const twinkleSpeeds = new Float32Array(count);
            const phases = new Float32Array(count);

            const starColors = [
                new THREE.Color(0xffffff), // White
                new THREE.Color(0x93c5fd), // Blue Giant
                new THREE.Color(0xfef08a), // Yellow Dwarf
                new THREE.Color(0xfca5a5), // Red Giant
                new THREE.Color(0xc4b5fd)  // Violet
            ];

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                // Distribute on upper hemisphere
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(Math.random() * 0.85); // Dome above
                const r = radius * (0.8 + Math.random() * 0.3);

                positions[i3] = r * Math.sin(phi) * Math.cos(theta);
                positions[i3 + 1] = r * Math.cos(phi) - 5;
                positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);

                const col = starColors[Math.floor(Math.random() * starColors.length)];
                colors[i3] = col.r;
                colors[i3 + 1] = col.g;
                colors[i3 + 2] = col.b;

                sizes[i] = 1.0 + Math.random() * 2.8;
                twinkleSpeeds[i] = 1.0 + Math.random() * 4.0;
                phases[i] = Math.random() * Math.PI * 2;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
            geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

            const material = new THREE.ShaderMaterial({
                vertexShader: SHADERS.starVertex,
                fragmentShader: SHADERS.starFragment,
                uniforms: this.uniforms,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            this.objects.starfield = new THREE.Points(geometry, material);
            this.scene.add(this.objects.starfield);
        }

        spawnMeteor() {
            const lineGeo = new THREE.BufferGeometry();
            const length = 12 + Math.random() * 15;
            const points = [];
            const alphas = [];

            const startX = (Math.random() - 0.5) * 50;
            const startY = 15 + Math.random() * 20;
            const startZ = -10 - Math.random() * 30;
            const dir = new THREE.Vector3(-1.0, -0.6, 0.4).normalize();

            for (let i = 0; i <= 10; i++) {
                const t = i / 10;
                points.push(
                    startX + dir.x * length * t,
                    startY + dir.y * length * t,
                    startZ + dir.z * length * t
                );
                alphas.push(t); // Head is brightest
            }

            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
            lineGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));

            const mat = new THREE.ShaderMaterial({
                vertexShader: SHADERS.meteorVertex,
                fragmentShader: SHADERS.meteorFragment,
                uniforms: this.uniforms,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });

            const line = new THREE.Line(lineGeo, mat);
            line.visible = false;
            this.scene.add(line);

            this.objects.meteors.push({
                mesh: line,
                speed: 35 + Math.random() * 25,
                timer: Math.random() * 5.0,
                active: false,
                startX, startY, startZ, dir, length
            });
        }

        // =====================================================================
        // OPEN-METEO REAL-TIME WEATHER API INTEGRATION
        // =====================================================================
        async fetchRealTimeWeather(locationKey) {
            const loc = WEATHER_LOCATIONS[locationKey] || WEATHER_LOCATIONS.hanoi;
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;

            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.current) {
                        const cur = data.current;
                        this.weatherData.temperature = cur.temperature_2m !== undefined ? cur.temperature_2m : 24.5;
                        this.weatherData.windSpeed = cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 12.0;
                        this.weatherData.humidity = cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : 70;
                        this.weatherData.weatherCode = cur.weather_code !== undefined ? cur.weather_code : 0;
                        this.weatherData.conditionText = this.getConditionText(this.weatherData.weatherCode);
                        this.weatherData.cityLabel = loc.name;
                        this.weatherData.lastUpdated = new Date();

                        // Map wind speed to shader wind force
                        const windNorm = (this.weatherData.windSpeed / 50.0); // 0 to 1
                        this.setWind(windNorm * 1.5);

                        this.updateHUDDisplay();
                    }
                }
            } catch (err) {
                console.warn('[ThreeWeatherEngine] Open-Meteo API fetch warning:', err);
                this.updateHUDDisplay();
            }
        }

        getConditionText(code) {
            if (code === 0) return 'Bầu trời quang đãng (Clear Sky)';
            if (code === 1 || code === 2) return 'Ít mây / Quang mây (Partly Cloudy)';
            if (code === 3) return 'Nhiều mây u ám (Overcast)';
            if (code >= 51 && code <= 67) return 'Mưa rào khí quyển (Rain Showers)';
            if (code >= 71 && code <= 77) return 'Tuyết rơi vùng cao (Snowfall)';
            if (code >= 80 && code <= 82) return 'Mưa dông lớn (Heavy Rain)';
            if (code >= 95) return 'Dông sét bão táp (Thunderstorm)';
            return 'Khí quyển ổn định (Stable)';
        }

        // =====================================================================
        // CONTROLS & PARAMETER ADJUSTMENTS
        // =====================================================================
        setCameraDepth(z) {
            this.params.cameraDepth = z;
            this.uniforms.uCameraZ.value = z;
            if (this.camera) {
                this.camera.position.z = z;
                this.camera.lookAt(0, 2.0, 0);
            }
        }

        setDensity(density) {
            this.params.particleDensity = density;
            this.uniforms.uParticleDensity.value = density / 1000.0;
            // Rebuild particles with new density
            this.setPreset(this.activePresetKey);
        }

        setWind(force) {
            this.params.windForce = force;
            this.uniforms.uWindForce.value = force;
        }

        setSpeed(speed) {
            this.params.fallSpeed = speed;
            this.uniforms.uFallSpeed.value = speed;
        }

        setGlow(intensity) {
            this.params.glowIntensity = intensity;
            this.uniforms.uBrightness.value = intensity;
        }

        // =====================================================================
        // RENDER LOOP & GPU LIFECYCLE MANAGEMENT
        // =====================================================================
        start() {
            if (this.isRunning) return;
            this.isRunning = true;
            this.lastFrameTime = performance.now();
            this.renderLoop();
        }

        pause() {
            this.isRunning = false;
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }
        }

        onTabActivated() {
            this.isTabActive = true;
            if (!this.renderer || !this.scene) {
                this.init('ws-canvas-wrapper', 'ws-viewport-canvas');
            }
            this.resize();
            this.start();
            this.updateHUDDisplay();
            setTimeout(() => this.resize(), 50);
            setTimeout(() => this.resize(), 200);
        }

        onTabDeactivated() {
            this.isTabActive = false;
            this.pause(); // Reduces GPU to 0% when navigating away
        }

        renderLoop() {
            if (!this.isRunning || !this.isTabActive) return;

            this.animFrameId = requestAnimationFrame(() => this.renderLoop());

            const now = performance.now();
            const delta = (now - this.lastFrameTime) / 1000;
            this.lastFrameTime = now;

            // Compute FPS
            this.frameCount++;
            if (delta > 0) {
                const fps = 1 / delta;
                this.fpsHistory.push(fps);
                if (this.fpsHistory.length > 20) this.fpsHistory.shift();
                if (this.frameCount % 15 === 0) {
                    const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
                    this.currentFps = Math.round(avgFps);
                    this.updateFPSDisplay();
                }
            }

            // Update Time Uniforms
            const elapsedTime = this.clock ? this.clock.getElapsedTime() : (now * 0.001);
            this.uniforms.uTime.value = elapsedTime;

            // Camera subtle floating sway
            if (this.params.autoRotateCamera && this.camera) {
                this.camera.position.x = Math.sin(elapsedTime * 0.15) * 2.5;
                this.camera.position.y = 4.0 + Math.cos(elapsedTime * 0.1) * 0.8;
                this.camera.lookAt(0, 2.0, 0);
            }

            // Animate Meteors in Galaxy mode
            if (this.objects.meteors && this.objects.meteors.length) {
                this.objects.meteors.forEach(m => {
                    m.timer -= delta;
                    if (m.timer <= 0 && !m.active) {
                        m.active = true;
                        m.mesh.visible = true;
                        m.mesh.position.set(0, 0, 0);
                    }
                    if (m.active) {
                        m.mesh.position.addScaledVector(m.dir, m.speed * delta);
                        if (m.mesh.position.y < -30) {
                            m.active = false;
                            m.mesh.visible = false;
                            m.timer = 2.0 + Math.random() * 4.0;
                            m.mesh.position.set(0, 0, 0);
                        }
                    }
                });
            }

            // Render Frame
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        }

        // =====================================================================
        // HUD & UI TELEMETRY UPDATES
        // =====================================================================
        updateHUDDisplay() {
            // Update Location & Weather HUD
            const elLoc = document.getElementById('ws-hud-location');
            if (elLoc) {
                elLoc.innerHTML = `🌍 ${this.weatherData.cityLabel.toUpperCase()} • ${this.weatherData.conditionText.toUpperCase()}`;
            }

            const elTemp = document.getElementById('ws-hud-live-temp');
            if (elTemp) {
                elTemp.textContent = `${this.weatherData.temperature.toFixed(1)}°C`;
            }

            const elWind = document.getElementById('ws-hud-live-wind');
            if (elWind) {
                elWind.textContent = `${this.weatherData.windSpeed.toFixed(1)} km/h`;
            }

            const elHumidity = document.getElementById('ws-hud-live-humidity');
            if (elHumidity) {
                elHumidity.textContent = `${this.weatherData.humidity}%`;
            }

            const elParticles = document.getElementById('ws-hud-particle-count');
            if (elParticles) {
                const count = this.params.particleDensity;
                elParticles.textContent = `⚡ 3D ${count} Hạt`;
            }

            const elLayers = document.getElementById('ws-hud-layers-text');
            if (elLayers) {
                const presetNames = {
                    tokyo_rain: 'Tokyo Cyber Rain & Ripple 3D (WebGL Shaders)',
                    tromso_aurora: 'Tromsø Volumetric Aurora Waves 3D (Simplex Noise)',
                    swiss_snow: 'Swiss Alps Depth Snowstorm 3D (Turbulence DoF)',
                    atacama_galaxy: 'Atacama Deep Space & Meteors 3D (Twinkle Starfield)'
                };
                elLayers.textContent = presetNames[this.activePresetKey] || '3D WebGL Atmospheric Shaders';
            }
        }

        updateFPSDisplay() {
            const elFps = document.getElementById('ws-hud-fps');
            if (elFps) {
                const fps = this.currentFps;
                const color = fps >= 50 ? '🟢' : fps >= 30 ? '🟡' : '🔴';
                elFps.textContent = `${color} ${fps} FPS (GPU)`;
            }
        }
    }

    // Export Global Instance
    window.ThreeWeatherEngine = ThreeWeatherEngine;
    window.threeWeatherEngine = new ThreeWeatherEngine();

})();
