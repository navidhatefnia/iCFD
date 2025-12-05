import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Pause, RefreshCw, Wand2, Wind, Droplets, Gauge, ChevronRight, Aperture, Image as ImageIcon, Waves } from 'lucide-react';
import { FluidCanvas } from './components/FluidCanvas';
import { analyzeFlow } from './services/geminiService';
import { SimulationConfig, AnalysisResult } from './types';

const MAX_GRID_SIZE = 200; // Max pixels on the longest side

const App: React.FC = () => {
  // State
  const [mode, setMode] = useState<'INPUT' | 'SIMULATION'>('INPUT');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showStreamlines, setShowStreamlines] = useState(false);
  const [obstacles, setObstacles] = useState<boolean[] | null>(null);
  const [config, setConfig] = useState<SimulationConfig>({
    viscosity: 0.04,
    windSpeed: 0.1,
    gridWidth: MAX_GRID_SIZE,
    gridHeight: MAX_GRID_SIZE,
    contrastThreshold: 100,
  });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Refs
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // For capturing/processing image
  const fluidCanvasRef = useRef<HTMLCanvasElement | null>(null); // From child component
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle File Upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setImageSrc(e.target.result as string);
          setMode('INPUT');
          setAnalysis(null);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Process Image & Start Simulation
  const runSimulation = () => {
    if (!sourceImageRef.current || !canvasRef.current) return;

    const img = sourceImageRef.current;
    // Calculate aspect ratio and grid dimensions
    const aspect = img.naturalWidth / img.naturalHeight;
    let gw = MAX_GRID_SIZE;
    let gh = MAX_GRID_SIZE;

    if (aspect > 1) {
        // Landscape
        gw = MAX_GRID_SIZE;
        gh = Math.round(MAX_GRID_SIZE / aspect);
    } else {
        // Portrait or Square
        gh = MAX_GRID_SIZE;
        gw = Math.round(MAX_GRID_SIZE * aspect);
    }

    // Ensure even numbers for better stability (optional but good practice)
    if (gw % 2 !== 0) gw++;
    if (gh % 2 !== 0) gh++;

    // Resize hidden canvas
    canvasRef.current.width = gw;
    canvasRef.current.height = gh;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Draw uploaded image to resized canvas
    ctx.drawImage(img, 0, 0, gw, gh);

    // Get Pixel Data
    const frame = ctx.getImageData(0, 0, gw, gh);
    const data = frame.data;
    const gridSize = gw * gh;
    const grid = new Array(gridSize).fill(false);

    // Thresholding
    for (let i = 0; i < data.length; i += 4) {
      // Simple grayscale conversion
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const avg = (r + g + b) / 3;
      
      // If dark -> solid (true)
      const isSolid = avg < config.contrastThreshold;
      grid[i / 4] = isSolid;
    }

    setConfig(prev => ({
        ...prev,
        gridWidth: gw,
        gridHeight: gh
    }));
    setObstacles(grid);
    setMode('SIMULATION');
    setIsRunning(true);
  };

  // Reset to input mode
  const handleReset = () => {
    setIsRunning(false);
    setMode('INPUT');
    // We keep the imageSrc so user can adjust or try again
  };

  // Trigger Gemini Analysis
  const handleAnalyze = async () => {
    if (!fluidCanvasRef.current) return;
    
    setIsAnalyzing(true);
    try {
      const dataUrl = fluidCanvasRef.current.toDataURL('image/png');
      const result = await analyzeFlow(dataUrl);
      setAnalysis(result);
    } catch (error) {
      console.error("Analysis Error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col md:flex-row overflow-hidden">
      
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Main View Area */}
      <div className="flex-1 relative flex flex-col h-[60vh] md:h-screen">
        
        {/* Header Overlay */}
        <div className="absolute top-0 left-0 right-0 p-4 z-20 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
               <Wind className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">AeroLens <span className="text-blue-500 text-xs align-top">PRO</span></h1>
          </div>
          <div className="flex gap-2">
             {mode === 'SIMULATION' && (
                <button 
                  onClick={handleReset}
                  className="bg-zinc-800/80 backdrop-blur hover:bg-zinc-700 p-2 rounded-full transition-colors border border-zinc-700"
                  title="New Simulation"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
             )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 bg-zinc-900 relative flex items-center justify-center overflow-hidden p-6">
           {mode === 'INPUT' ? (
             <div className="relative w-full h-full flex items-center justify-center bg-zinc-900">
               
               {/* File Input (Hidden) */}
               <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
               />

               {!imageSrc ? (
                 <div className="flex flex-col items-center gap-6 p-8 text-center max-w-md">
                    <div className="w-24 h-24 rounded-2xl bg-zinc-800 border-2 border-dashed border-zinc-700 flex items-center justify-center mb-2">
                      <ImageIcon className="w-10 h-10 text-zinc-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white mb-2">Upload Shape Image</h2>
                      <p className="text-zinc-400 text-sm">Select a black & white image to run a 2D CFD simulation. Black areas become solid obstacles.</p>
                    </div>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-900/20"
                    >
                      <Upload className="w-5 h-5" />
                      Select Image
                    </button>
                 </div>
               ) : (
                 <>
                   {/* Image Preview */}
                   <div className="w-full h-full flex items-center justify-center p-4">
                      <img 
                        ref={sourceImageRef}
                        src={imageSrc} 
                        alt="Preview"
                        className="max-w-full max-h-full object-contain opacity-50"
                      />
                   </div>

                   {/* Change Image Button */}
                   <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-black/50 hover:bg-black/70 backdrop-blur text-sm text-white rounded-full border border-white/10 flex items-center gap-2 transition-all"
                      >
                        <Upload className="w-3 h-3" /> Change Image
                      </button>
                   </div>
                   
                   {/* Run Button Overlay */}
                   <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                      {/* Target Zone Box for visual framing - removed fixed size to avoid confusion with dynamic bounds */}
                      <div className="px-4 py-2 rounded-lg bg-black/60 backdrop-blur border border-white/20 mb-12">
                         <span className="text-white/80 text-xs">Ready to Simulate</span>
                      </div>
                   </div>

                   <div className="absolute bottom-12 left-0 right-0 flex justify-center z-30">
                     <button 
                       onClick={runSimulation}
                       className="group relative flex items-center justify-center"
                     >
                       <div className="absolute inset-0 bg-blue-500 rounded-full blur opacity-20 group-hover:opacity-40 transition-opacity duration-500"></div>
                       <div className="w-20 h-20 bg-white rounded-full border-4 border-zinc-300 flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-transform shadow-2xl relative z-10">
                          <Play className="w-8 h-8 text-blue-600 ml-1" />
                       </div>
                       <span className="absolute -bottom-8 text-sm font-bold text-white tracking-wider opacity-80">RUN CFD</span>
                     </button>
                   </div>
                 </>
               )}
             </div>
           ) : (
             <div className="w-full h-full flex items-center justify-center bg-black">
               {/* Fluid Canvas Wrapper with Dynamic Aspect Ratio */}
               <div 
                className="relative shadow-2xl rounded-lg overflow-hidden border border-zinc-800"
                style={{ 
                    aspectRatio: `${config.gridWidth} / ${config.gridHeight}`,
                    height: config.gridHeight > config.gridWidth ? '95%' : 'auto',
                    width: config.gridWidth >= config.gridHeight ? '95%' : 'auto',
                    maxWidth: '100%',
                    maxHeight: '100%'
                }}
               >
                 <FluidCanvas 
                    config={config} 
                    isRunning={isRunning} 
                    obstacles={obstacles}
                    showStreamlines={showStreamlines}
                    onCanvasRef={(ref) => fluidCanvasRef.current = ref}
                 />
                 <div className="absolute bottom-4 right-4 flex gap-2 z-10">
                    <button 
                      onClick={() => setIsRunning(!isRunning)}
                      className="p-3 bg-zinc-800/90 text-white rounded-full hover:bg-zinc-700 backdrop-blur border border-zinc-600 shadow-xl"
                    >
                      {isRunning ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                    </button>
                 </div>
               </div>
             </div>
           )}
        </div>
      </div>

      {/* Sidebar Controls */}
      <div className="md:w-96 bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800 h-[40vh] md:h-screen overflow-y-auto flex flex-col">
        <div className="p-6 space-y-8">
          
          {/* Controls Section */}
          <div className="space-y-6">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Physics Parameters
            </h2>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">Wind Speed</span>
                  <span className="text-blue-400 font-mono">{config.windSpeed.toFixed(2)}</span>
                </div>
                <input 
                  type="range" 
                  min="0.01" 
                  max="0.2" 
                  step="0.01" 
                  value={config.windSpeed}
                  onChange={(e) => setConfig({...config, windSpeed: parseFloat(e.target.value)})}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">Viscosity</span>
                  <span className="text-blue-400 font-mono">{config.viscosity.toFixed(3)}</span>
                </div>
                <input 
                  type="range" 
                  min="0.005" 
                  max="0.1" 
                  step="0.001" 
                  value={config.viscosity}
                  onChange={(e) => setConfig({...config, viscosity: parseFloat(e.target.value)})}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
              
               <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">Contrast Threshold</span>
                  <span className="text-blue-400 font-mono">{config.contrastThreshold}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="255" 
                  step="1" 
                  value={config.contrastThreshold}
                  onChange={(e) => setConfig({...config, contrastThreshold: parseInt(e.target.value)})}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <p className="text-xs text-zinc-600">Adjust to distinguish solid (black) from fluid (white).</p>
              </div>

              {mode === 'SIMULATION' && (
                  <div className="text-xs text-zinc-500 font-mono pt-2 border-t border-zinc-800">
                      Grid: {config.gridWidth} x {config.gridHeight}
                  </div>
              )}
            </div>
          </div>

          {/* Visualization Controls */}
          <div className="space-y-4 border-t border-zinc-800 pt-6">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <Waves className="w-4 h-4" /> Visualization
            </h2>
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Show Streamlines</span>
              <button 
                onClick={() => setShowStreamlines(!showStreamlines)}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${showStreamlines ? 'bg-blue-600' : 'bg-zinc-700'}`}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${showStreamlines ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          {/* AI Analysis Section */}
          <div className="space-y-4 border-t border-zinc-800 pt-6">
            <div className="flex items-center justify-between">
               <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Aperture className="w-4 h-4" /> Gemini Analysis
               </h2>
               {mode === 'SIMULATION' && (
                 <button 
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="text-xs bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-lg shadow-purple-900/20"
                 >
                   {isAnalyzing ? (
                     <RefreshCw className="w-3 h-3 animate-spin" />
                   ) : (
                     <Wand2 className="w-3 h-3" />
                   )}
                   {isAnalyzing ? 'Analyzing...' : 'Analyze Flow'}
                 </button>
               )}
            </div>

            {analysis ? (
              <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 space-y-3 animate-fade-in">
                <div className="flex justify-between items-start">
                   <h3 className="font-semibold text-white">{analysis.title}</h3>
                   <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                     analysis.dragEstimate === 'High' ? 'bg-red-900/30 border-red-700 text-red-400' :
                     analysis.dragEstimate === 'Low' ? 'bg-green-900/30 border-green-700 text-green-400' :
                     'bg-yellow-900/30 border-yellow-700 text-yellow-400'
                   }`}>
                     Drag: {analysis.dragEstimate}
                   </span>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {analysis.description}
                </p>
                
                {analysis.suggestions.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs font-medium text-zinc-500 mb-2">OPTIMIZATION TIPS</p>
                    <ul className="space-y-2">
                      {analysis.suggestions.map((s, i) => (
                        <li key={i} className="text-xs text-zinc-300 flex gap-2">
                          <ChevronRight className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 px-4 border border-dashed border-zinc-800 rounded-xl">
                 <p className="text-sm text-zinc-600">
                   {mode === 'INPUT' 
                     ? "Upload an image to enable analysis." 
                     : "Run the simulation for a moment, then click 'Analyze Flow' to get AI insights."}
                 </p>
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-auto p-4 border-t border-zinc-900 text-center">
          <p className="text-[10px] text-zinc-600">Powered by Lattice Boltzmann Method & Gemini 2.5 Flash</p>
        </div>
      </div>
    </div>
  );
};

export default App;