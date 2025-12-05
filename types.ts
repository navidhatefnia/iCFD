export enum SimulationState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
}

export interface SimulationConfig {
  viscosity: number;
  windSpeed: number;
  gridWidth: number;
  gridHeight: number;
  contrastThreshold: number; // 0-255, for binary conversion
}

export interface AnalysisResult {
  title: string;
  description: string;
  dragEstimate: string;
  suggestions: string[];
}