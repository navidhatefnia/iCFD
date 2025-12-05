/**
 * Lattice Boltzmann Method (D2Q9) Fluid Solver
 * Optimized for stability and real-time browser performance.
 */

// D2Q9 constants
const N_DISCRETE_VELOCITIES = 9;
// Velocity vectors (x, y)
const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
// Weights
const W = [
  4 / 9,
  1 / 9, 1 / 9, 1 / 9, 1 / 9,
  1 / 36, 1 / 36, 1 / 36, 1 / 36
];
// Opposite direction indices for bounce-back
// 0(0,0) -> 0
// 1(1,0) <-> 3(-1,0)
// 2(0,1) <-> 4(0,-1)
// 5(1,1) <-> 7(-1,-1)
// 6(-1,1) <-> 8(1,-1)
const OPPOSITE = [0, 3, 4, 1, 2, 7, 8, 5, 6];

export class LBMSolver {
  width: number;
  height: number;
  viscosity: number; 
  omega: number; 
  
  // Macroscopic
  rho: Float32Array; 
  ux: Float32Array;  
  uy: Float32Array;  
  
  // Microscopic
  f: Float32Array[]; 
  fNew: Float32Array[];
  
  barrier: boolean[]; 

  constructor(width: number, height: number, viscosity: number) {
    this.width = width;
    this.height = height;
    this.viscosity = viscosity;
    this.omega = 1 / (3 * viscosity + 0.5);
    
    const size = width * height;
    
    this.rho = new Float32Array(size).fill(1);
    this.ux = new Float32Array(size).fill(0);
    this.uy = new Float32Array(size).fill(0);
    this.barrier = new Array(size).fill(false);
    
    this.f = [];
    this.fNew = [];
    
    for (let i = 0; i < N_DISCRETE_VELOCITIES; i++) {
      this.f[i] = new Float32Array(size);
      this.fNew[i] = new Float32Array(size);
      for (let j = 0; j < size; j++) {
        this.f[i][j] = W[i]; // rho=1, u=0
      }
    }
  }

  public setObstacles(barriers: boolean[]) {
    if (barriers.length !== this.width * this.height) return;
    this.barrier = barriers;
  }

  public setViscosity(v: number) {
    this.viscosity = v;
    this.omega = 1 / (3 * v + 0.5);
  }

  private computeEquilibrium(i: number, rho: number, ux: number, uy: number): number {
    const eu = EX[i] * ux + EY[i] * uy;
    const uv = ux * ux + uy * uy;
    return W[i] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * uv);
  }

  public step(inletSpeed: number) {
    const w = this.width;
    const h = this.height;
    
    // STREAMING STEP (Pull Method)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        
        if (this.barrier[idx]) {
          // Inside obstacle: Do nothing or reset.
          // We reset to zero velocity for visualization purposes mostly.
          this.ux[idx] = 0;
          this.uy[idx] = 0;
          this.rho[idx] = 1;
          continue; 
        }

        // For each direction, pull from source
        for (let i = 0; i < N_DISCRETE_VELOCITIES; i++) {
          const srcX = x - EX[i];
          const srcY = y - EY[i];
          
          // Check Boundaries
          if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
            const srcIdx = srcY * w + srcX;
            
            if (this.barrier[srcIdx]) {
              // BOUNCE-BACK: Source is solid.
              // Reflect the particle that was going OUT into the wall back IN.
              // i.e., take current distribution at THIS cell pointing TO the wall.
              const opp = OPPOSITE[i];
              this.fNew[i][idx] = this.f[opp][idx]; 
            } else {
              // Standard Streaming
              this.fNew[i][idx] = this.f[i][srcIdx];
            }
          } else {
            // DOMAIN BOUNDARY CONDITIONS
            
            if (srcX < 0) {
              // INLET (Left Wall)
              // Set to Equilibrium with Inlet Speed
              this.fNew[i][idx] = this.computeEquilibrium(i, 1.0, inletSpeed, 0);
            } 
            else if (srcX >= w) {
              // OUTLET (Right Wall)
              // Zero Gradient: Copy from neighbor (x-1)
              // The neighbor is (w-1, y). The source coord was (w, y).
              // We just copy from the cell at (w-1, y) corresponding to this direction?
              // Or better, assume fully developed flow -> Equilibrium with neighbor velocity.
              // Simple approximation: Copy f from x-1
              const neighborIdx = y * w + (w - 1);
              this.fNew[i][idx] = this.f[i][neighborIdx];
            }
            else {
              // TOP / BOTTOM Walls
              // Free slip approximation: Equilibrium with horizontal speed of neighbor?
              // Or just Equilibrium with Inlet Speed (simulating infinite wind tunnel)
              this.fNew[i][idx] = this.computeEquilibrium(i, 1.0, inletSpeed, 0);
            }
          }
        }
      }
    }

    // COLLISION STEP
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        
        if (this.barrier[idx]) continue;

        // Calculate Macroscopic Moments
        let rho = 0;
        let ux = 0;
        let uy = 0;

        for (let i = 0; i < N_DISCRETE_VELOCITIES; i++) {
          const fVal = this.fNew[i][idx];
          rho += fVal;
          ux += fVal * EX[i];
          uy += fVal * EY[i];
        }

        // Normalize velocity
        if (rho > 0) {
             ux /= rho;
             uy /= rho;
        }

        // Clamp velocity for stability (prevent NaN explosion)
        // LBM fails if u > 0.3-ish. Clamp strictly.
        const maxU = 0.35;
        const speed = Math.sqrt(ux*ux + uy*uy);
        if (speed > maxU) {
             const scale = maxU / speed;
             ux *= scale;
             uy *= scale;
        }

        this.rho[idx] = rho;
        this.ux[idx] = ux;
        this.uy[idx] = uy;

        // BGK Collision
        for (let i = 0; i < N_DISCRETE_VELOCITIES; i++) {
          const feq = this.computeEquilibrium(i, rho, ux, uy);
          this.fNew[i][idx] = (1 - this.omega) * this.fNew[i][idx] + this.omega * feq;
        }
      }
    }

    // Swap pointers
    const temp = this.f;
    this.f = this.fNew;
    this.fNew = temp;
  }
}