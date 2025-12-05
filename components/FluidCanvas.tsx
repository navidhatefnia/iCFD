import React, { useEffect, useRef } from 'react';
import { LBMSolver } from '../services/lbmSolver';
import { SimulationConfig } from '../types';

interface FluidCanvasProps {
  config: SimulationConfig;
  isRunning: boolean;
  obstacles: boolean[] | null;
  showStreamlines: boolean;
  onCanvasRef: (ref: HTMLCanvasElement | null) => void;
}

// Shader Sources - Unchanged logic, just ensure we render to high res
const vsSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fsSource = `#version 300 es
precision highp float;
uniform sampler2D u_tex_ux;
uniform sampler2D u_tex_uy;
uniform sampler2D u_tex_obs;
in vec2 v_uv;
out vec4 outColor;

vec3 getJetColor(float t) {
    t = clamp(t, 0.0, 1.0);
    // Darker, more "scientific" Jet/Turbo-like mapping for contrast
    // 0.0: Black/Blue -> 1.0: Red/White
    vec3 color;
    if (t < 0.15) {
        // Deep blue fade
        color = vec3(0.0, 0.0, 0.5 + t * 3.33); 
    } else if (t < 0.4) {
        // Blue to Cyan
        color = vec3(0.0, (t - 0.15) * 4.0, 1.0);
    } else if (t < 0.7) {
        // Cyan to Yellow (skip strong green for better aesthetics)
        color = vec3((t - 0.4) * 3.33, 1.0, 1.0 - (t - 0.4) * 3.33);
    } else {
        // Yellow to Red
        color = vec3(1.0, 1.0 - (t - 0.7) * 3.33, 0.0);
    }
    return color;
}

void main() {
    float obs = texture(u_tex_obs, v_uv).r;
    if (obs > 0.5) {
        outColor = vec4(0.05, 0.05, 0.05, 1.0); // Soft black for obstacles
        return;
    }

    float ux = texture(u_tex_ux, v_uv).r;
    float uy = texture(u_tex_uy, v_uv).r;
    float speed = sqrt(ux*ux + uy*uy);

    // Normalize speed (approx max 0.15)
    float n = clamp(speed * 6.0, 0.0, 1.0);
    
    // Smooth out the look by reducing harsh contours
    vec3 color = getJetColor(n);

    // Subtle contours
    float numContours = 20.0;
    float vScaled = n * numContours;
    float fraction = fract(vScaled);
    if (fraction < 0.05) {
        color *= 0.85; // Slight darkening for contour
    }

    outColor = vec4(color, 1.0);
}`;

// Render Resolution Multiplier (upscale from physics grid)
const RENDER_SCALE = 4; 

export const FluidCanvas: React.FC<FluidCanvasProps> = ({ config, isRunning, obstacles, showStreamlines, onCanvasRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const solverRef = useRef<LBMSolver | null>(null);
  const requestRef = useRef<number>(0);
  
  // WebGL Context & Resources
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const texturesRef = useRef<{ ux: WebGLTexture, uy: WebGLTexture, obs: WebGLTexture } | null>(null);
  const obsDataRef = useRef<Uint8Array | null>(null);

  const renderWidth = config.gridWidth * RENDER_SCALE;
  const renderHeight = config.gridHeight * RENDER_SCALE;

  // Initialize Solver
  useEffect(() => {
    // Check if solver dimensions match config, otherwise re-init
    if (!solverRef.current || solverRef.current.width !== config.gridWidth || solverRef.current.height !== config.gridHeight) {
       solverRef.current = new LBMSolver(config.gridWidth, config.gridHeight, config.viscosity);
    } else {
       solverRef.current.setViscosity(config.viscosity);
    }
  }, [config.gridWidth, config.gridHeight, config.viscosity]);

  // Handle Obstacles
  useEffect(() => {
    if (obstacles && solverRef.current) {
        // Ensure obstacle array size matches current grid
        if (obstacles.length === config.gridWidth * config.gridHeight) {
            solverRef.current.setObstacles(obstacles);
            
            const size = config.gridWidth * config.gridHeight;
            const data = new Uint8Array(size);
            for(let i=0; i<size; i++) {
                data[i] = obstacles[i] ? 255 : 0;
            }
            obsDataRef.current = data;
            
            const gl = glRef.current;
            const texs = texturesRef.current;
            if (gl && texs) {
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, texs.obs);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, config.gridWidth, config.gridHeight, 0, gl.RED, gl.UNSIGNED_BYTE, data);
            }
        }
    }
  }, [obstacles, config.gridWidth, config.gridHeight]);

  // Initialize WebGL
  useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      onCanvasRef(canvas);

      const gl = canvas.getContext('webgl2', { alpha: false });
      if (!gl) {
          console.error("WebGL2 not supported");
          return;
      }
      glRef.current = gl;

      // Extensions
      gl.getExtension('EXT_color_buffer_float');
      const floatLinear = gl.getExtension('OES_texture_float_linear');

      // Shaders
      const createShader = (type: number, source: string) => {
          const shader = gl.createShader(type);
          if (!shader) return null;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
              console.error(gl.getShaderInfoLog(shader));
              gl.deleteShader(shader);
              return null;
          }
          return shader;
      };

      const vs = createShader(gl.VERTEX_SHADER, vsSource);
      const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return;

      const program = gl.createProgram();
      if (!program) return;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error(gl.getProgramInfoLog(program));
          return;
      }
      programRef.current = program;

      // Buffers
      const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      // Textures
      const createTexture = (isFloat = false, isNearest = false) => {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          
          let filter: number = gl.LINEAR;
          if (isNearest) {
            filter = gl.NEAREST;
          } else if (isFloat && !floatLinear) {
            filter = gl.NEAREST; 
          }

          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter as number); 
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter as number); 
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return tex;
      };

      const uxTex = createTexture(true);
      const uyTex = createTexture(true);
      const obsTex = createTexture(false, true);

      if (!uxTex || !uyTex || !obsTex) return;

      texturesRef.current = { ux: uxTex, uy: uyTex, obs: obsTex };

      const w = config.gridWidth;
      const h = config.gridHeight;
      
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, uxTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, uyTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
      
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, obsTex);
      if (obsDataRef.current && obsDataRef.current.length === w * h) {
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, obsDataRef.current);
      } else {
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      }

      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, 'u_tex_ux'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'u_tex_uy'), 1);
      gl.uniform1i(gl.getUniformLocation(program, 'u_tex_obs'), 2);
      
      return () => {
          gl.deleteProgram(program);
          gl.deleteTexture(uxTex);
          gl.deleteTexture(uyTex);
          gl.deleteTexture(obsTex);
      };

  }, [config.gridWidth, config.gridHeight]);

  // Bilinear Sample Helper (CPU side for streamlines)
  const sample = (data: Float32Array, x: number, y: number, w: number) => {
     // Clamping
     const xx = Math.max(0, Math.min(x, w - 1.001));
     // Height is implicit in data length / w, assume caller clamps y correctly
     // or just clamp liberally
     
     const x0 = Math.floor(xx);
     const y0 = Math.floor(y); // y already clamped by caller mostly
     const x1 = x0 + 1;
     const y1 = y0 + 1;
     
     const dx = xx - x0;
     const dy = y - y0;
     
     // Boundary check for indices
     if (y0 < 0 || y1 >= (data.length / w)) return 0;
     
     const i00 = y0 * w + x0;
     const i10 = y0 * w + x1;
     const i01 = y1 * w + x0;
     const i11 = y1 * w + x1;
     
     // Safe access?
     if (i11 >= data.length) return 0;

     const v00 = data[i00];
     const v10 = data[i10];
     const v01 = data[i01];
     const v11 = data[i11];
     
     const v0 = v00 * (1 - dx) + v10 * dx;
     const v1 = v01 * (1 - dx) + v11 * dx;
     
     return v0 * (1 - dy) + v1 * dy;
  };

  // Animation Loop
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const textures = texturesRef.current;
    const overlayCanvas = overlayRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    
    if (!gl || !program || !textures || !overlayCtx || !overlayCanvas) return;

    const animate = () => {
      const solver = solverRef.current;
      if (isRunning && solver) {
        const stepsPerFrame = 6;
        for(let i=0; i<stepsPerFrame; i++) {
           solver.step(config.windSpeed);
        }
      }

      if (solver) {
        // --- WebGL Rendering ---
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures.ux);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, config.gridWidth, config.gridHeight, 0, gl.RED, gl.FLOAT, solver.ux);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures.uy);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, config.gridWidth, config.gridHeight, 0, gl.RED, gl.FLOAT, solver.uy);

        // Render to the full high-res canvas
        gl.viewport(0, 0, renderWidth, renderHeight);
        gl.useProgram(program);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // --- Streamlines ---
        overlayCtx.clearRect(0, 0, renderWidth, renderHeight);
        
        if (showStreamlines) {
            overlayCtx.lineWidth = 1.2;
            overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            overlayCtx.lineCap = 'round';
            overlayCtx.beginPath();

            const simW = config.gridWidth;
            const simH = config.gridHeight;
            // Denser streamlines: stride = 3 simulation pixels
            const stride = 3; 
            const stepSize = 0.5; // smaller steps for smoother curves
            const maxSteps = simW * 2.5;

            // Loop through simulation grid coordinates
            for (let startY = 2; startY < simH - 2; startY += stride) {
                // Also add some horizontal offsets to break grid patterns if desired
                let cx = 0;
                let cy = startY + (Math.random() * 0.5); 

                // Start path in Render Coordinates
                overlayCtx.moveTo(cx * RENDER_SCALE, cy * RENDER_SCALE);

                for (let step = 0; step < maxSteps; step++) {
                    // Check bounds
                    if (cx < 0 || cx >= simW - 1 || cy < 0 || cy >= simH - 1) break;
                    
                    // Sample velocity (Bilinear)
                    const u = sample(solver.ux, cx, cy, simW);
                    const v = sample(solver.uy, cx, cy, simW);
                    
                    const speed = Math.sqrt(u * u + v * v);
                    if (speed < 0.001) break; // Stagnation

                    // Check obstacle (Integer lookup sufficient)
                    const ix = Math.floor(cx);
                    const iy = Math.floor(cy);
                    if (solver.barrier[iy * simW + ix]) break;

                    // Integrate
                    const dx = (u / speed) * stepSize;
                    const dy = (v / speed) * stepSize;
                    
                    cx += dx;
                    cy += dy;
                    
                    // Draw in Render Coordinates
                    overlayCtx.lineTo(cx * RENDER_SCALE, cy * RENDER_SCALE);
                }
            }
            overlayCtx.stroke();
        }
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isRunning, config.windSpeed, showStreamlines, config.gridWidth, config.gridHeight, renderWidth, renderHeight]);

  return (
    <div className="relative w-full h-full rounded-lg bg-black overflow-hidden group">
        {/* WebGL Background Layer (Upscaled) */}
        <canvas 
          ref={canvasRef} 
          width={renderWidth} 
          height={renderHeight}
          className="absolute inset-0 w-full h-full object-contain"
        />
        {/* Streamline Overlay Layer (High Res) */}
        <canvas 
          ref={overlayRef}
          width={renderWidth} 
          height={renderHeight}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
    </div>
  );
};