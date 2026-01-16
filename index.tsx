import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html, Line, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { 
  Map as MapIcon, FileText, Upload, Settings, Layers, Download, Plus, Trash2, Globe,
  AlertCircle, Cpu, Move, ZoomIn, ZoomOut, Save, FolderOpen, Box, Ruler, Grid as GridIcon,
  Copy, Crosshair, BarChartBig, Eye, MousePointer2, CheckSquare, Square, Hand, Circle,
  Maximize, Magnet, Trash, Undo, Redo, Pentagon, Type as TypeIcon, Palette, FileUp, Eraser, Sun, Moon, Info, ChevronRight, CheckCircle2,
  Filter, Image as ImageIcon, Disc, Calculator, GripVertical, PenTool, Keyboard, BoxSelect, History, FileJson, Clock, FileSpreadsheet
} from 'lucide-react';

// --- Types ---
interface SurveyPoint {
  id: string;
  x: number; y: number; z: number; desc: string;
}
interface MapAnnotation {
  id: string; x: number; y: number; text: string; size: number; color: string;
}
interface SurveyPolygon {
  id: string;
  points: {x: number, y: number}[];
  color: string;
  area: number;
  perimeter: number;
  filled: boolean;
}
interface ProjectMetadata {
  title: string; owner: string; location: string; registryId: string; professional: string; crea: string; utmZone: string;
}
interface MapViewBox {
  x: number; y: number; w: number; h: number;
}
interface ColumnMapping {
  id: number; x: number; y: number; z: number; desc: number; delimiter: string; name?: string;
}
interface LayerConfig {
  pointColor: string; 
  selectedColor: string; 
  hoverColor: string;
  lineColor: string; 
  lineWidth: number; 
  pointSize: number; 
  showLabels: boolean; 
  theme: 'light' | 'dark';
  gridColor: string;
  gridSpacing: number;
}
interface ToolTooltip {
  name: string;
  description: string;
}
interface ProjectSnapshot {
    id: string;
    name: string;
    date: number;
    data: {
        points: SurveyPoint[];
        annotations: MapAnnotation[];
        polygons: SurveyPolygon[];
        metadata: ProjectMetadata;
    }
}

// --- Utils ---
const calculateArea = (points: {x: number, y: number}[]) => {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
};
const calculatePerimeter = (points: {x: number, y: number}[]) => {
  if (points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
};
const calculateAzimuth = (p1: {x: number, y: number}, p2: {x: number, y: number}) => {
    const dy = p2.y - p1.y;
    const dx = p2.x - p1.x;
    let theta = Math.atan2(dx, dy); // Azimuth from North (Y axis)
    if (theta < 0) theta += 2 * Math.PI;
    return (theta * 180) / Math.PI;
};
const toDMS = (deg: number) => {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    const s = ((deg - d) * 60 - m) * 60;
    return `${d}°${m.toString().padStart(2, '0')}'${s.toFixed(2).padStart(5, '0')}"`;
};

// --- App Component ---
const App = () => {
  const [activeTab, setActiveTab] = useState<'map' | 'data' | 'memorial' | '3d' | 'charts'>('map');
  
  // State
  const [points, setPoints] = useState<SurveyPoint[]>([
    { id: 'M-01', x: 250100.500, y: 7450100.200, z: 750.00, desc: 'Marco' },
    { id: 'M-02', x: 250250.000, y: 7450120.500, z: 752.10, desc: 'Cerca' },
    { id: 'M-03', x: 250280.300, y: 7449980.100, z: 748.50, desc: 'Vértice' },
    { id: 'M-04', x: 250090.100, y: 7449950.000, z: 749.20, desc: 'Estrada' },
  ]);
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([]);
  const [polygons, setPolygons] = useState<SurveyPolygon[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // Covers Points, Annos, Polygons
  
  // History
  const [history, setHistory] = useState<{points: SurveyPoint[], annotations: MapAnnotation[], polygons: SurveyPolygon[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Layer Config
  const [layerConfig, setLayerConfig] = useState<LayerConfig>({
    pointColor: '#06b6d4', 
    selectedColor: '#f59e0b',
    hoverColor: '#ffffff',
    lineColor: '#52525b',
    lineWidth: 1,
    pointSize: 4,
    showLabels: true,
    theme: 'dark',
    gridColor: '', // Empty means default based on theme
    gridSpacing: 50
  });

  const [metadata, setMetadata] = useState<ProjectMetadata>({
    title: 'Projeto Topográfico Alpha', owner: 'Cliente Exemplo', location: 'São Paulo, SP', registryId: '', professional: '', crea: '', utmZone: '23S'
  });
  const [viewBox, setViewBox] = useState<MapViewBox>({ x: 0, y: 0, w: 1000, h: 1000 });
  const [mapStyle, setMapStyle] = useState<'tech' | 'satellite' | 'clean'>('tech');
  
  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);

  // History Logic
  useEffect(() => {
    if (history.length === 0) {
        setHistory([{ points, annotations, polygons }]);
        setHistoryIndex(0);
    }
  }, []);

  const updateStateWithHistory = (newPoints: SurveyPoint[], newAnnotations: MapAnnotation[] = annotations, newPolygons: SurveyPolygon[] = polygons) => {
      const currentEntry = { points: newPoints, annotations: newAnnotations, polygons: newPolygons };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentEntry);
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setPoints(newPoints);
      setAnnotations(newAnnotations);
      setPolygons(newPolygons);
  };

  const undo = () => {
      if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          const entry = history[prevIndex];
          setPoints(entry.points);
          setAnnotations(entry.annotations);
          setPolygons(entry.polygons);
          setHistoryIndex(prevIndex);
      }
  };

  const redo = () => {
      if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const entry = history[nextIndex];
          setPoints(entry.points);
          setAnnotations(entry.annotations);
          setPolygons(entry.polygons);
          setHistoryIndex(nextIndex);
      }
  };

  // CSV Import Helpers
  const [importText, setImportText] = useState('');
  const [manualMapping, setManualMapping] = useState<ColumnMapping>({ id: 0, x: 1, y: 2, z: 3, desc: 4, delimiter: ',' });
  const [savedMappings, setSavedMappings] = useState<ColumnMapping[]>([]);

  useEffect(() => {
      const saved = localStorage.getItem('geoProMappings');
      if (saved) {
          setSavedMappings(JSON.parse(saved));
      }
  }, []);

  const saveMapping = () => {
      const name = prompt("Nome da configuração de mapeamento:");
      if (name) {
          const newMapping = { ...manualMapping, name };
          const newMappings = [...savedMappings, newMapping];
          setSavedMappings(newMappings);
          localStorage.setItem('geoProMappings', JSON.stringify(newMappings));
      }
  };

  const handleManualImport = () => {
      if (!importText.trim()) return;
      try {
         const lines = importText.trim().split('\n');
         const newPoints: SurveyPoint[] = [];
         
         lines.forEach((line, index) => {
            if (line.trim() === '') return;
            let cols: string[];
            if (manualMapping.delimiter === 'tab') cols = line.split('\t');
            else if (manualMapping.delimiter === 'space') cols = line.trim().split(/\s+/);
            else cols = line.split(manualMapping.delimiter);
  
            cols = cols.map(c => c.replace(/^"|"$/g, '').trim());
            if (cols.length < 3) return; 
  
            const p: SurveyPoint = {
               id: cols[manualMapping.id] || `P${points.length + index + 1}`,
               x: parseFloat(cols[manualMapping.x]) || 0,
               y: parseFloat(cols[manualMapping.y]) || 0,
               z: parseFloat(cols[manualMapping.z]) || 0,
               desc: cols[manualMapping.desc] || ''
            };
            
            if (!isNaN(p.x) && !isNaN(p.y)) newPoints.push(p);
         });
  
         updateStateWithHistory([...points, ...newPoints]);
         setShowImportModal(false);
         setImportText('');
         alert(`${newPoints.length} pontos importados.`);
      } catch (e) {
         alert("Erro na importação. Verifique o mapeamento.");
      }
  };

  // KML Export
  const exportKML = () => {
      let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${metadata.title || "Projeto Topográfico"}</name>
    <description>Exportado via GeoPro CAD</description>
    <Style id="pointStyle">
      <IconStyle><scale>1.0</scale></IconStyle>
    </Style>
    <Style id="polyStyle">
      <LineStyle><color>ff0000ff</color><width>2</width></LineStyle>
      <PolyStyle><color>400000ff</color></PolyStyle>
    </Style>
`;
      // Points
      points.forEach(p => {
          kml += `    <Placemark>
      <name>${p.id}</name>
      <description>${p.desc}</description>
      <styleUrl>#pointStyle</styleUrl>
      <Point><coordinates>${p.x},${p.y},${p.z}</coordinates></Point>
    </Placemark>\n`;
      });
      // Polygons
      polygons.forEach(poly => {
          const coordStr = poly.points.map(pt => `${pt.x},${pt.y},0`).join(' ');
          kml += `    <Placemark>
      <name>${poly.id}</name>
      <styleUrl>#polyStyle</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing><coordinates>${coordStr} ${poly.points[0].x},${poly.points[0].y},0</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>\n`;
      });

      kml += `  </Document>\n</kml>`;
      
      const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${metadata.title || 'projeto'}.kml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // JSON Export
  const exportJSON = () => {
      const projectData = {
          metadata,
          points,
          annotations,
          polygons,
          layerConfig,
          version: "1.0"
      };
      const jsonStr = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${metadata.title || 'projeto'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  // Snapshots Logic
  const loadSnapshot = (snapshot: ProjectSnapshot) => {
      if(confirm(`Carregar versão "${snapshot.name}"? O estado atual não salvo será perdido.`)) {
          setPoints(snapshot.data.points);
          setAnnotations(snapshot.data.annotations);
          setPolygons(snapshot.data.polygons);
          setMetadata(snapshot.data.metadata);
          updateStateWithHistory(snapshot.data.points, snapshot.data.annotations, snapshot.data.polygons);
          setShowVersionModal(false);
      }
  };

  return (
    <div className={`flex h-screen w-full font-sans overflow-hidden ${layerConfig.theme === 'dark' ? 'bg-cad-bg text-cad-text' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* Sidebar - Pro Look */}
      <aside className={`w-64 border-r flex flex-col z-30 shadow-xl ${layerConfig.theme === 'dark' ? 'bg-cad-panel border-cad-border' : 'bg-white border-slate-200'}`}>
        <div className="h-14 flex items-center px-4 border-b border-inherit">
          <Globe className="h-5 w-5 text-cad-accent mr-2" />
          <span className="font-bold text-lg tracking-tight">GeoPro <span className="text-[10px] uppercase text-cad-accent tracking-widest bg-cad-accent/10 px-1 rounded">CAD</span></span>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider opacity-50">Módulos</div>
          <NavBtn active={activeTab === 'map'} onClick={() => setActiveTab('map')} icon={<MapIcon size={18} />} label="Model Space (Mapa)" theme={layerConfig.theme} />
          <NavBtn active={activeTab === 'data'} onClick={() => setActiveTab('data')} icon={<Layers size={18} />} label="Data Table" theme={layerConfig.theme} />
          <NavBtn active={activeTab === '3d'} onClick={() => setActiveTab('3d')} icon={<Box size={18} />} label="Visualização 3D" theme={layerConfig.theme} />
          <NavBtn active={activeTab === 'charts'} onClick={() => setActiveTab('charts')} icon={<BarChartBig size={18} />} label="Análise/Perfil" theme={layerConfig.theme} />
          <NavBtn active={activeTab === 'memorial'} onClick={() => setActiveTab('memorial')} icon={<FileText size={18} />} label="Relatórios" theme={layerConfig.theme} />
        </nav>

        <div className="p-3 border-t border-inherit bg-opacity-50">
           <button onClick={() => setShowImportModal(true)} className="w-full mb-2 bg-cad-accent text-white py-2 rounded text-xs font-bold hover:brightness-110 flex items-center justify-center gap-2"><Upload size={14}/> IMPORTAR DADOS</button>
           <div className={`rounded-lg p-3 ${layerConfig.theme === 'dark' ? 'bg-black/20' : 'bg-slate-100'}`}>
             <div className="flex justify-between text-xs mb-1">
               <span className="opacity-70">Pontos</span>
               <span className="font-mono font-bold text-cad-accent">{points.length}</span>
             </div>
             <div className="flex justify-between text-xs mb-1">
               <span className="opacity-70">Polígonos</span>
               <span className="font-mono font-bold">{polygons.length}</span>
             </div>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        <header className={`h-14 border-b flex items-center justify-between px-6 z-20 ${layerConfig.theme === 'dark' ? 'bg-cad-panel border-cad-border' : 'bg-white border-slate-200'}`}>
           <div className="flex items-center gap-4">
              <h1 className="font-semibold text-sm">{metadata.title}</h1>
              <div className={`h-4 w-px ${layerConfig.theme === 'dark' ? 'bg-white/10' : 'bg-slate-300'}`}></div>
              <span className="text-xs opacity-60 font-mono">{metadata.location}</span>
           </div>
           <div className="flex items-center space-x-2">
             <button onClick={() => setShowVersionModal(true)} className={`p-2 rounded hover:bg-black/10 transition text-xs flex items-center gap-2 ${layerConfig.theme === 'dark' ? 'text-cad-text' : 'text-slate-600'}`}>
                <Clock size={14}/> Versões
             </button>
             <button onClick={exportJSON} className={`p-2 rounded hover:bg-black/10 transition text-xs flex items-center gap-2 ${layerConfig.theme === 'dark' ? 'text-cad-text' : 'text-slate-600'}`}>
                <FileJson size={14}/> Export Project
             </button>
             <button onClick={exportKML} className={`p-2 rounded hover:bg-black/10 transition text-xs flex items-center gap-2 ${layerConfig.theme === 'dark' ? 'text-cad-text' : 'text-slate-600'}`}>
                <Download size={14}/> Export KML
             </button>
             <button onClick={() => setShowConfigModal(true)} className={`p-2 rounded hover:bg-black/10 transition text-xs flex items-center gap-2 ${layerConfig.theme === 'dark' ? 'text-cad-text' : 'text-slate-600'}`}>
                <Settings size={14}/> Config
             </button>
           </div>
        </header>

        <div className="flex-1 relative overflow-hidden">
          {activeTab === 'map' && (
            <SurveyMap 
              points={points} setPoints={setPoints}
              annotations={annotations} setAnnotations={setAnnotations}
              polygons={polygons} setPolygons={setPolygons}
              viewBox={viewBox} setViewBox={setViewBox}
              mapStyle={mapStyle} setMapStyle={setMapStyle}
              selectedIds={selectedIds} setSelectedIds={setSelectedIds}
              undo={undo} redo={redo} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1}
              openConfig={() => setShowConfigModal(true)}
              layerConfig={layerConfig}
              clearDrawing={() => updateStateWithHistory([], [])}
              pushHistory={updateStateWithHistory}
            />
          )}
          {activeTab === 'data' && <DataEditor points={points} setPoints={(pts:any) => updateStateWithHistory(pts)} metadata={metadata} setMetadata={setMetadata} selectedIds={selectedIds} setSelectedIds={setSelectedIds} theme={layerConfig.theme} />}
          {activeTab === '3d' && <View3D points={points} theme={layerConfig.theme} />}
          {activeTab === 'charts' && <ElevationProfile points={points} theme={layerConfig.theme} />}
          {activeTab === 'memorial' && (
              <MemorialGenerator 
                  metadata={metadata} 
                  points={points} 
                  polygons={polygons} 
                  selectedIds={selectedIds} 
                  theme={layerConfig.theme}
              />
          )}
        </div>
      </main>

       {/* Configuration Modal */}
       {showConfigModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className={`rounded-lg w-full max-w-sm shadow-2xl p-6 border animate-in fade-in zoom-in-95 ${layerConfig.theme === 'dark' ? 'bg-cad-panel border-cad-border text-cad-text' : 'bg-white border-slate-200 text-slate-900'}`}>
                  <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Palette size={20} className="text-cad-accent"/> Aparência</h3>
                  <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setLayerConfig({...layerConfig, theme: 'light'})} className={`py-2 text-xs font-medium rounded border transition flex items-center justify-center gap-2 ${layerConfig.theme === 'light' ? 'bg-white border-cad-accent text-cad-accent' : 'bg-black/5'}`}><Sun size={14}/> Paper Space</button>
                            <button onClick={() => setLayerConfig({...layerConfig, theme: 'dark'})} className={`py-2 text-xs font-medium rounded border transition flex items-center justify-center gap-2 ${layerConfig.theme === 'dark' ? 'bg-cad-bg border-cad-accent text-cad-accent' : 'bg-white/5'}`}><Moon size={14}/> Model Space</button>
                      </div>
                      
                      <div className="space-y-2 pt-2 border-t border-inherit border-opacity-20">
                          <label className="text-xs font-bold opacity-60 uppercase block">Cores</label>
                          <div className="grid grid-cols-3 gap-2">
                             <div>
                                 <label className="text-[10px] opacity-50 block mb-1">Padrão</label>
                                 <input type="color" value={layerConfig.pointColor} onChange={(e) => setLayerConfig({...layerConfig, pointColor: e.target.value})} className="w-full h-8 rounded cursor-pointer bg-transparent border border-inherit"/>
                             </div>
                             <div>
                                 <label className="text-[10px] opacity-50 block mb-1">Seleção</label>
                                 <input type="color" value={layerConfig.selectedColor} onChange={(e) => setLayerConfig({...layerConfig, selectedColor: e.target.value})} className="w-full h-8 rounded cursor-pointer bg-transparent border border-inherit"/>
                             </div>
                             <div>
                                 <label className="text-[10px] opacity-50 block mb-1">Hover</label>
                                 <input type="color" value={layerConfig.hoverColor} onChange={(e) => setLayerConfig({...layerConfig, hoverColor: e.target.value})} className="w-full h-8 rounded cursor-pointer bg-transparent border border-inherit"/>
                             </div>
                          </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-inherit border-opacity-20">
                           <label className="text-xs font-bold opacity-60 uppercase block">Grade (Grid)</label>
                           <div className="grid grid-cols-2 gap-2">
                               <div>
                                   <label className="text-[10px] opacity-50 block mb-1">Cor</label>
                                   <input type="color" value={layerConfig.gridColor || (layerConfig.theme === 'dark' ? '#333333' : '#e2e8f0')} onChange={(e) => setLayerConfig({...layerConfig, gridColor: e.target.value})} className="w-full h-8 rounded cursor-pointer bg-transparent border border-inherit"/>
                               </div>
                               <div>
                                   <label className="text-[10px] opacity-50 block mb-1">Espaçamento</label>
                                   <input type="number" min="10" max="500" value={layerConfig.gridSpacing} onChange={(e) => setLayerConfig({...layerConfig, gridSpacing: parseInt(e.target.value)})} className="w-full h-8 px-2 rounded bg-transparent border border-inherit text-xs"/>
                               </div>
                           </div>
                      </div>

                      <div className="pt-2 border-t border-inherit border-opacity-20">
                          <div className="flex justify-between mb-1">
                             <label className="text-xs font-bold opacity-60 uppercase">Tamanho do Ponto</label>
                             <span className="text-xs font-mono">{layerConfig.pointSize}px</span>
                          </div>
                          <input type="range" min="1" max="15" value={layerConfig.pointSize} onChange={(e) => setLayerConfig({...layerConfig, pointSize: parseInt(e.target.value)})} className="w-full accent-cad-accent"/>
                      </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                      <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 bg-cad-accent text-white rounded text-sm font-medium hover:brightness-110">Concluir</button>
                  </div>
              </div>
          </div>
      )}

      {/* Version Control Modal */}
      {showVersionModal && (
          <VersionControlModal 
              currentData={{ points, annotations, polygons, metadata }} 
              onLoad={loadSnapshot} 
              onClose={() => setShowVersionModal(false)}
              theme={layerConfig.theme}
          />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
             <div className={`rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] border animate-in fade-in zoom-in-95 ${layerConfig.theme === 'dark' ? 'bg-cad-panel border-cad-border text-cad-text' : 'bg-white border-slate-200 text-slate-900'}`}>
                <div className="p-4 border-b border-inherit flex justify-between items-center">
                    <h3 className="font-bold text-lg">Importar CSV / TXT</h3>
                    <button onClick={() => setShowImportModal(false)}><Trash2 size={18} className="opacity-50 hover:opacity-100"/></button>
                </div>
                <div className="p-6 flex-1 overflow-auto space-y-4">
                    <div className="flex gap-4">
                         <div className="flex-1 space-y-2">
                             <label className="text-xs font-bold opacity-50 uppercase">Mapeamento de Colunas (Índice)</label>
                             <div className="grid grid-cols-5 gap-2">
                                {['ID', 'X', 'Y', 'Z', 'Desc'].map((l, i) => (
                                    <div key={l}>
                                        <label className="text-[10px] opacity-40 block">{l}</label>
                                        <input type="number" 
                                            value={Object.values(manualMapping)[i]} 
                                            onChange={(e) => setManualMapping({...manualMapping, [Object.keys(manualMapping)[i]]: parseInt(e.target.value)})}
                                            className={`w-full p-1 text-xs border rounded ${layerConfig.theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-slate-50 border-slate-200'}`}
                                        />
                                    </div>
                                ))}
                             </div>
                         </div>
                         <div className="w-32 space-y-2">
                             <label className="text-xs font-bold opacity-50 uppercase">Separador</label>
                             <select value={manualMapping.delimiter} onChange={(e) => setManualMapping({...manualMapping, delimiter: e.target.value})} className={`w-full p-1 text-xs border rounded ${layerConfig.theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
                                 <option value=",">Vírgula</option>
                                 <option value=";">Ponto e Vírgula</option>
                                 <option value="tab">Tab (TSV)</option>
                                 <option value="space">Espaço</option>
                             </select>
                         </div>
                    </div>
                    
                    {savedMappings.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-2">
                            {savedMappings.map((m, i) => (
                                <button key={i} onClick={() => setManualMapping(m)} className="px-3 py-1 bg-cad-accent/10 border border-cad-accent/30 text-cad-accent rounded-full text-xs hover:bg-cad-accent/20 whitespace-nowrap">
                                    {m.name || `Config ${i+1}`}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-between items-center">
                        <label className="text-xs font-bold opacity-50 uppercase">Dados Brutos</label>
                        <button onClick={saveMapping} className="text-xs text-cad-accent hover:underline flex items-center gap-1"><Save size={12}/> Salvar Mapeamento</button>
                    </div>
                    <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className={`w-full h-40 p-3 font-mono text-xs rounded border ${layerConfig.theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-slate-50 border-slate-200'}`} placeholder="Cole seus dados aqui..."></textarea>
                </div>
                <div className="p-4 border-t border-inherit flex justify-end gap-2">
                    <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-sm opacity-60 hover:opacity-100">Cancelar</button>
                    <button onClick={handleManualImport} className="px-6 py-2 bg-cad-accent text-white rounded text-sm font-bold shadow-lg hover:brightness-110">Processar Importação</button>
                </div>
             </div>
        </div>
      )}
    </div>
  );
};

// --- Survey Map ---

interface SurveyMapProps {
  points: SurveyPoint[];
  setPoints: (points: SurveyPoint[]) => void;
  annotations: MapAnnotation[];
  setAnnotations: (annos: MapAnnotation[]) => void;
  polygons: SurveyPolygon[];
  setPolygons: (polys: SurveyPolygon[]) => void;
  viewBox: MapViewBox;
  setViewBox: (v: MapViewBox) => void;
  mapStyle: 'tech' | 'satellite' | 'clean';
  setMapStyle: (s: 'tech' | 'satellite' | 'clean') => void;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  openConfig: () => void;
  layerConfig: LayerConfig;
  clearDrawing: () => void;
  pushHistory: (pts: SurveyPoint[], annos: MapAnnotation[], polys: SurveyPolygon[]) => void;
}

const SurveyMap = ({ 
  points, setPoints, annotations, setAnnotations, polygons, setPolygons,
  viewBox, setViewBox, mapStyle, setMapStyle, 
  selectedIds, setSelectedIds, undo, redo, canUndo, canRedo, 
  openConfig, layerConfig, clearDrawing, pushHistory
}: SurveyMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Tools
  const [activeTool, setActiveTool] = useState<'select' | 'pan' | 'point' | 'polyline' | 'move' | 'delete' | 'measure' | 'area' | 'text' | 'box-select'>('select');
  const [cursorCoords, setCursorCoords] = useState({ x: 0, y: 0 }); // World
  const [mouseScreenCoords, setMouseScreenCoords] = useState({ x: 0, y: 0 }); // Screen for tooltip
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(true);
  
  // View History for Undo Zoom
  const [viewHistory, setViewHistory] = useState<MapViewBox[]>([]);

  // Manual Point Modal
  const [showPointModal, setShowPointModal] = useState(false);
  const [newPointData, setNewPointData] = useState({ x: '', y: '', z: '', desc: '' });

  // Dragging / Moving
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Screen coords
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 }); // World coords offset for move tool
  
  // Selection Box State
  const [selectionBoxStart, setSelectionBoxStart] = useState<{x: number, y: number} | null>(null);
  const [selectionBoxEnd, setSelectionBoxEnd] = useState<{x: number, y: number} | null>(null);

  // Move Tool State
  const [movingId, setMovingId] = useState<string | null>(null);
  const [movingType, setMovingType] = useState<'point' | 'annotation' | 'polygon' | null>(null);
  const [originalPos, setOriginalPos] = useState<{x: number, y: number} | null>(null);

  // Interaction State
  const [hoverPoint, setHoverPoint] = useState<SurveyPoint | null>(null);
  const [hoverTool, setHoverTool] = useState<ToolTooltip | null>(null);
  const [measureStart, setMeasureStart] = useState<{x: number, y: number} | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{x: number, y: number} | null>(null);
  const [areaPoints, setAreaPoints] = useState<{x: number, y: number}[]>([]);

  // Theme Constants
  const isDark = layerConfig.theme === 'dark';
  const colors = {
    bg: isDark ? '#18181b' : '#ffffff',
    grid: layerConfig.gridColor || (isDark ? 'rgba(255,255,255,0.05)' : '#e2e8f0'),
    line: layerConfig.lineColor,
    point: layerConfig.pointColor,
    select: layerConfig.selectedColor,
    hover: layerConfig.hoverColor,
    text: isDark ? '#e4e4e7' : '#334155'
  };

  const bounds = useMemo(() => {
    if (points.length === 0) return { minX:0, maxX:100, minY:0, maxY:100, w:100, h:100 };
    const xs = points.map(p => p.x); const ys = points.map(p => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const w = maxX - minX || 10; const h = maxY - minY || 10;
    return { minX: minX - w * 0.1, maxX: maxX + w * 0.1, minY: minY - h * 0.1, maxY: maxY + h * 0.1, w: w * 1.2, h: h * 1.2 };
  }, [points]);

  const transform = useMemo(() => {
     const scaleX = 1000 / bounds.w; const scaleY = 1000 / bounds.h;
     const scale = Math.min(scaleX, scaleY);
     const drawnW = bounds.w * scale; const drawnH = bounds.h * scale;
     const offsetX = (1000 - drawnW) / 2; const offsetY = (1000 - drawnH) / 2;
     return { scale, offsetX, offsetY, minX: bounds.minX, maxY: bounds.maxY };
  }, [bounds]);

  const toSvg = (x: number, y: number) => ({
    svgX: (x - transform.minX) * transform.scale + transform.offsetX,
    svgY: (transform.maxY - y) * transform.scale + transform.offsetY
  });

  const fromSvg = (svgX: number, svgY: number) => ({
    x: (svgX - transform.offsetX) / transform.scale + transform.minX,
    y: transform.maxY - (svgY - transform.offsetY) / transform.scale
  });

  const getNearestSnapPoint = (x: number, y: number, toleranceScreen: number = 15) => {
      const zoomFactor = viewBox.w / 1000; 
      const toleranceWorld = (toleranceScreen * zoomFactor) / transform.scale;
      let nearest = null;
      let minD = Infinity;
      
      // Points
      points.forEach(p => {
          const d = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
          if (d < toleranceWorld && d < minD) { minD = d; nearest = { x: p.x, y: p.y }; }
      });
      // Active Area Drawing
      areaPoints.forEach(p => {
          const d = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
          if (d < toleranceWorld && d < minD) { minD = d; nearest = { x: p.x, y: p.y }; }
      });
      // Saved Polygons Vertices
      polygons.forEach(poly => {
          poly.points.forEach(p => {
              const d = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
              if (d < toleranceWorld && d < minD) { minD = d; nearest = { x: p.x, y: p.y }; }
          });
      });

      return nearest;
  };

  const handleZoomExtents = () => {
      const newViewBox = {
          x: 0, y: 0, w: 1000, h: 1000
      };
      setViewHistory([...viewHistory, viewBox]);
      setViewBox(newViewBox);
  };

  const handleZoomPrevious = () => {
      if (viewHistory.length > 0) {
          const prev = viewHistory[viewHistory.length - 1];
          setViewHistory(viewHistory.slice(0, -1));
          setViewBox(prev);
      }
  };

  // --- Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    const worldPos = fromSvg(svgClickX, svgClickY);

    if (activeTool === 'pan') {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
    }
    if (activeTool === 'box-select') {
        setSelectionBoxStart(worldPos);
        setSelectionBoxEnd(worldPos);
        return;
    }
    if (activeTool === 'move') {
        const tolerance = (15 * zoomFactor) / transform.scale;
        const hitPoint = points.find(p => Math.sqrt((p.x - worldPos.x)**2 + (p.y - worldPos.y)**2) < tolerance);
        if (hitPoint) {
            setMovingId(hitPoint.id); setMovingType('point');
            setOriginalPos({ x: hitPoint.x, y: hitPoint.y });
            setDragOffset({ x: worldPos.x - hitPoint.x, y: worldPos.y - hitPoint.y });
            setIsDragging(true); return;
        }
        const hitAnno = annotations.find(a => Math.sqrt((a.x - worldPos.x)**2 + (a.y - worldPos.y)**2) < tolerance);
        if (hitAnno) {
            setMovingId(hitAnno.id); setMovingType('annotation');
            setOriginalPos({ x: hitAnno.x, y: hitAnno.y });
            setDragOffset({ x: worldPos.x - hitAnno.x, y: worldPos.y - hitAnno.y });
            setIsDragging(true); return;
        }
    }
    if (activeTool === 'select') {
       const tolerance = (15 * zoomFactor) / transform.scale;
       // Check Points
       const hit = points.find(p => Math.sqrt((p.x - worldPos.x)**2 + (p.y - worldPos.y)**2) < tolerance);
       if (hit) {
           const newSet = new Set(e.shiftKey ? selectedIds : []);
           if (e.shiftKey && selectedIds.has(hit.id)) newSet.delete(hit.id); else newSet.add(hit.id);
           setSelectedIds(newSet); return;
       } 
       // Check Annotations
       const hitAnno = annotations.find(a => Math.sqrt((a.x - worldPos.x)**2 + (a.y - worldPos.y)**2) < tolerance);
       if (hitAnno) {
           const newSet = new Set(e.shiftKey ? selectedIds : []);
           if (e.shiftKey && selectedIds.has(hitAnno.id)) newSet.delete(hitAnno.id); else newSet.add(hitAnno.id);
           setSelectedIds(newSet); return;
       }
       setIsDragging(true); setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    setMouseScreenCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top }); // For Tooltip

    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    let worldPos = fromSvg(svgClickX, svgClickY);
    
    if (snapEnabled && (activeTool !== 'pan' && activeTool !== 'select' && activeTool !== 'box-select')) {
         const snap = getNearestSnapPoint(worldPos.x, worldPos.y);
         if (snap) worldPos = snap;
    }
    setCursorCoords({ x: worldPos.x, y: worldPos.y });

    if (activeTool === 'box-select' && selectionBoxStart) {
        setSelectionBoxEnd(worldPos);
    }

    if (activeTool === 'pan' && isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setViewBox({ ...viewBox, x: viewBox.x - dx * zoomFactor, y: viewBox.y - dy * zoomFactor });
        setDragStart({ x: e.clientX, y: e.clientY });
    } else if (activeTool === 'select' && isDragging) {
        // Pan behavior in select tool
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setViewBox({ ...viewBox, x: viewBox.x - dx * zoomFactor, y: viewBox.y - dy * zoomFactor });
        setDragStart({ x: e.clientX, y: e.clientY });
    }
    if (activeTool === 'move' && isDragging && movingId) {
        const newX = worldPos.x - dragOffset.x;
        const newY = worldPos.y - dragOffset.y;
        let finalPos = { x: newX, y: newY };
        if (snapEnabled) {
            const snap = getNearestSnapPoint(newX, newY);
            if (snap) finalPos = snap;
        }
        if (movingType === 'point') setPoints(points.map(p => p.id === movingId ? { ...p, x: finalPos.x, y: finalPos.y } : p));
        else if (movingType === 'annotation') setAnnotations(annotations.map(a => a.id === movingId ? { ...a, x: finalPos.x, y: finalPos.y } : a));
    }
    if (activeTool === 'measure' && measureStart) setMeasureEnd(worldPos);
  };

  const handleMouseUp = () => {
    if (activeTool === 'move' && isDragging && movingId) pushHistory(points, annotations, polygons);
    
    if (activeTool === 'box-select' && selectionBoxStart && selectionBoxEnd) {
        // Calculate selection
        const minX = Math.min(selectionBoxStart.x, selectionBoxEnd.x);
        const maxX = Math.max(selectionBoxStart.x, selectionBoxEnd.x);
        const minY = Math.min(selectionBoxStart.y, selectionBoxEnd.y);
        const maxY = Math.max(selectionBoxStart.y, selectionBoxEnd.y);

        const newSelection = new Set<string>();
        
        // Select Points
        points.forEach(p => {
            if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
                newSelection.add(p.id);
            }
        });

        // Select Annotations
        annotations.forEach(a => {
             if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) {
                newSelection.add(a.id);
            }
        });
        
        // Select Polygons (if any point is inside)
        polygons.forEach(p => {
            const inside = p.points.some(pt => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY);
            if(inside) newSelection.add(p.id);
        });

        setSelectedIds(newSelection);
        setSelectionBoxStart(null);
        setSelectionBoxEnd(null);
        setActiveTool('select'); // Switch back to select after box
    }

    setIsDragging(false); setMovingId(null); setMovingType(null); setOriginalPos(null);
  };

  const handleMapClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    let worldPos = fromSvg(svgClickX, svgClickY);
    if (snapEnabled) {
        const snap = getNearestSnapPoint(worldPos.x, worldPos.y);
        if (snap) worldPos = snap;
    }
    if (activeTool === 'point' || activeTool === 'polyline') {
        const newId = `P${(points.length + 1).toString().padStart(2, '0')}`;
        const newPoints = [...points, { id: newId, x: worldPos.x, y: worldPos.y, z: 0, desc: 'Novo Ponto' }];
        setPoints(newPoints); pushHistory(newPoints, annotations, polygons);
    }
    if (activeTool === 'text') {
        const text = prompt("Conteúdo da anotação:");
        if (text) {
             const newAnnos = [...annotations, { id: `T${annotations.length + 1}`, x: worldPos.x, y: worldPos.y, text, size: 12, color: isDark ? '#FFF' : '#000' }];
             setAnnotations(newAnnos); pushHistory(points, newAnnos, polygons); setActiveTool('select');
        }
    }
    if (activeTool === 'delete') {
         const tolerance = (15 * zoomFactor) / transform.scale;
         const hitPointIdx = points.findIndex(p => Math.sqrt((p.x - worldPos.x)**2 + (p.y - worldPos.y)**2) < tolerance);
         if (hitPointIdx !== -1) { 
             const newP = points.filter((_, i) => i !== hitPointIdx);
             setPoints(newP); pushHistory(newP, annotations, polygons); return; 
         }
         const hitAnnoIdx = annotations.findIndex(a => Math.sqrt((a.x - worldPos.x)**2 + (a.y - worldPos.y)**2) < tolerance);
         if (hitAnnoIdx !== -1) { 
             const newA = annotations.filter((_, i) => i !== hitAnnoIdx);
             setAnnotations(newA); pushHistory(points, newA, polygons); return;
         }
         // Polygons handle delete by selection usually
         const hitPoly = polygons.find(poly => {
            // Rough centroid check for click
            const cx = poly.points.reduce((acc,p)=>acc+p.x,0)/poly.points.length;
            const cy = poly.points.reduce((acc,p)=>acc+p.y,0)/poly.points.length;
            return Math.sqrt((cx-worldPos.x)**2 + (cy-worldPos.y)**2) < tolerance * 2;
         });
         if (hitPoly) {
             const newPolys = polygons.filter(p => p.id !== hitPoly.id);
             setPolygons(newPolys); pushHistory(points, annotations, newPolys);
         }
    }
    if (activeTool === 'area') setAreaPoints([...areaPoints, worldPos]);
    if (activeTool === 'measure') {
        if (!measureStart) { setMeasureStart(worldPos); setMeasureEnd(worldPos); } 
        else { setMeasureEnd(worldPos); setActiveTool('select'); }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomIntensity = 0.1;
    const direction = e.deltaY > 0 ? 1 : -1;
    const wChange = viewBox.w * zoomIntensity * direction;
    const hChange = viewBox.h * zoomIntensity * direction;
    setViewBox({ x: viewBox.x - wChange / 2, y: viewBox.y - hChange / 2, w: viewBox.w + wChange, h: viewBox.h + hChange });
  };

  const handleManualAddPoint = () => {
      if(newPointData.x && newPointData.y) {
          const newId = `P${(points.length + 1).toString().padStart(2, '0')}`;
          const p: SurveyPoint = {
              id: newId,
              x: parseFloat(newPointData.x),
              y: parseFloat(newPointData.y),
              z: parseFloat(newPointData.z) || 0,
              desc: newPointData.desc || 'Manual'
          };
          const newPoints = [...points, p];
          setPoints(newPoints);
          pushHistory(newPoints, annotations, polygons);
          setShowPointModal(false);
          setNewPointData({x:'',y:'',z:'',desc:''});
      }
  }

  const handleFinishArea = () => {
      if (areaPoints.length < 3) {
          setAreaPoints([]);
          setActiveTool('select');
          return;
      }
      const area = calculateArea(areaPoints);
      const perimeter = calculatePerimeter([...areaPoints, areaPoints[0]]);
      const newPoly: SurveyPolygon = {
          id: `Lote ${polygons.length + 1}`,
          points: [...areaPoints],
          color: layerConfig.selectedColor,
          area,
          perimeter,
          filled: true
      };
      const newPolys = [...polygons, newPoly];
      setPolygons(newPolys);
      pushHistory(points, annotations, newPolys);
      setAreaPoints([]);
      setSelectedIds(new Set([newPoly.id]));
      setActiveTool('select');
  };

  // --- Render Prep ---
  const gridLines = useMemo(() => {
    if (!gridEnabled) return [];
    const topLeft = fromSvg(viewBox.x, viewBox.y);
    const bottomRight = fromSvg(viewBox.x + viewBox.w, viewBox.y + viewBox.h);
    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, bottomRight.y);
    const step = layerConfig.gridSpacing || 50;
    const startX = Math.ceil(minX / step) * step;
    const startY = Math.ceil(minY / step) * step;
    const lines = [];
    for (let x = startX; x <= maxX; x += step) lines.push({ x1: toSvg(x, minY).svgX, y1: 0, x2: toSvg(x, minY).svgX, y2: 10000 });
    for (let y = startY; y <= maxY; y += step) lines.push({ x1: -10000, y1: toSvg(minX, y).svgY, x2: 10000, y2: toSvg(minX, y).svgY });
    return lines;
  }, [viewBox, transform, gridEnabled, layerConfig.gridSpacing]);

  const dist = measureStart && measureEnd ? Math.sqrt((measureEnd.x - measureStart.x)**2 + (measureEnd.y - measureStart.y)**2) : 0;
  
  // Update Selection Data based on WHAT is selected
  const selectionData = useMemo(() => {
     if (selectedIds.size === 0) return null;
     const id = Array.from(selectedIds)[0];
     
     // Check if it's a Polygon
     const poly = polygons.find(p => p.id === id);
     if (poly) return { type: 'polygon', data: poly };

     // Check if it's an Annotation
     const anno = annotations.find(a => a.id === id);
     if (anno) return { type: 'annotation', data: anno };

     // Check if it's a Set of Points
     const selectedPoints = points.filter(p => selectedIds.has(p.id));
     if (selectedPoints.length > 0) return { type: 'points', data: selectedPoints };

     return null;
  }, [points, polygons, annotations, selectedIds]);

  return (
    <div className={`w-full h-full relative overflow-hidden flex flex-col ${isDark ? 'bg-[#18181b]' : 'bg-white'}`}>
      
      {/* Ribbon Toolbar */}
      <div className={`h-11 border-b flex items-center px-2 space-x-1 shrink-0 ${isDark ? 'bg-cad-panel border-cad-border' : 'bg-white border-slate-200'}`}>
          <ToolGroup>
             <ToolbarBtn icon={<MousePointer2 size={16}/>} active={activeTool === 'select'} onClick={() => setActiveTool('select')} name="Selection" desc="Select objects in the map." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<BoxSelect size={16}/>} active={activeTool === 'box-select'} onClick={() => setActiveTool('box-select')} name="Box Select" desc="Select multiple objects by area." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Hand size={16}/>} active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} name="Pan" desc="Drag to pan the view." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Maximize size={16}/>} active={false} onClick={handleZoomExtents} name="Zoom Extents" desc="Fit all objects in view." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<History size={16}/>} active={false} onClick={handleZoomPrevious} disabled={viewHistory.length === 0} name="Zoom Previous" desc="Undo last zoom." theme={layerConfig.theme} onHover={setHoverTool}/>
          </ToolGroup>
          <Separator theme={layerConfig.theme}/>
          <ToolGroup>
             <ToolbarBtn icon={<Circle size={16}/>} active={activeTool === 'point'} onClick={() => setActiveTool('point')} name="Point" desc="Create single survey points." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Keyboard size={16}/>} active={false} onClick={() => setShowPointModal(true)} name="Manual Point" desc="Input Coordinates Manually." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<TypeIcon size={16}/>} active={activeTool === 'polyline'} onClick={() => setActiveTool('polyline')} name="Polyline" desc="Draw connected lines." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Pentagon size={16}/>} active={activeTool === 'area'} onClick={() => setActiveTool('area')} name="Area" desc="Define a closed area polygon." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<TypeIcon size={16}/>} active={activeTool === 'text'} onClick={() => setActiveTool('text')} name="Annotation" desc="Add text labels to the map." theme={layerConfig.theme} onHover={setHoverTool}/>
          </ToolGroup>
          <Separator theme={layerConfig.theme}/>
          <ToolGroup>
             <ToolbarBtn icon={<Move size={16}/>} active={activeTool === 'move'} onClick={() => setActiveTool('move')} name="Move" desc="Move points or annotations." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Ruler size={16}/>} active={activeTool === 'measure'} onClick={() => { setActiveTool('measure'); setMeasureStart(null); }} name="Measure" desc="Measure distances between points." theme={layerConfig.theme} onHover={setHoverTool}/>
             <ToolbarBtn icon={<Trash size={16}/>} active={activeTool === 'delete'} onClick={() => setActiveTool('delete')} name="Delete" desc="Remove objects from the drawing." theme={layerConfig.theme} onHover={setHoverTool}/>
          </ToolGroup>
          <div className="flex-1"></div>
          <ToolGroup>
              <ToolbarBtn icon={<Undo size={16}/>} onClick={undo} disabled={!canUndo} name="Undo" desc="Revert last action." theme={layerConfig.theme} onHover={setHoverTool}/>
              <ToolbarBtn icon={<Redo size={16}/>} onClick={redo} disabled={!canRedo} name="Redo" desc="Redo reversed action." theme={layerConfig.theme} onHover={setHoverTool}/>
          </ToolGroup>
      </div>

      <div className="flex-1 relative flex">
         <div ref={containerRef} 
              className={`flex-1 relative ${activeTool === 'pan' ? 'cursor-grab' : activeTool === 'move' ? 'cursor-move' : 'cursor-crosshair'} outline-none`}
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onClick={handleMapClick} onWheel={handleWheel}
         >
            <svg viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`} className="w-full h-full block" preserveAspectRatio="xMidYMid meet">
                {gridLines.map((l, i) => (<line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={colors.grid} strokeWidth={1 * (viewBox.w/1000)} vectorEffect="non-scaling-stroke"/>))}
                
                {/* SAVED POLYGONS */}
                {polygons.map(poly => {
                     const pointsStr = poly.points.map(p => { const {svgX,svgY} = toSvg(p.x, p.y); return `${svgX},${svgY}`; }).join(' ');
                     const isSelected = selectedIds.has(poly.id);
                     return (
                         <polygon 
                            key={poly.id} 
                            points={pointsStr} 
                            fill={poly.color} 
                            fillOpacity={0.2} 
                            stroke={isSelected ? '#fff' : poly.color} 
                            strokeWidth={isSelected ? 3 * (viewBox.w/1000) : 2 * (viewBox.w/1000)} 
                            vectorEffect="non-scaling-stroke"
                            onClick={(e) => {
                                e.stopPropagation();
                                const newSet = new Set(e.shiftKey ? selectedIds : []);
                                if(!e.shiftKey) newSet.add(poly.id);
                                setSelectedIds(newSet);
                            }}
                            className="cursor-pointer hover:opacity-80"
                         />
                     );
                })}

                {/* TEMP AREA DRAWING */}
                {areaPoints.length > 0 && (
                    <polygon points={areaPoints.map(p => { const {svgX,svgY}=toSvg(p.x, p.y); return `${svgX},${svgY}`; }).join(' ')} fill="rgba(16, 185, 129, 0.2)" stroke="#10b981" strokeWidth={2 * (viewBox.w/1000)} />
                )}

                {/* SELECTION BOX */}
                {selectionBoxStart && selectionBoxEnd && activeTool === 'box-select' && (
                    <rect 
                        x={Math.min(toSvg(selectionBoxStart.x, selectionBoxStart.y).svgX, toSvg(selectionBoxEnd.x, selectionBoxEnd.y).svgX)}
                        y={Math.min(toSvg(selectionBoxStart.x, selectionBoxStart.y).svgY, toSvg(selectionBoxEnd.x, selectionBoxEnd.y).svgY)}
                        width={Math.abs(toSvg(selectionBoxEnd.x, selectionBoxEnd.y).svgX - toSvg(selectionBoxStart.x, selectionBoxStart.y).svgX)}
                        height={Math.abs(toSvg(selectionBoxEnd.x, selectionBoxEnd.y).svgY - toSvg(selectionBoxStart.x, selectionBoxStart.y).svgY)}
                        fill={colors.select}
                        fillOpacity={0.1}
                        stroke={colors.select}
                        strokeWidth={1 * (viewBox.w/1000)}
                        strokeDasharray="4 2"
                    />
                )}

                {measureStart && measureEnd && (
                   <g>
                     <line x1={toSvg(measureStart.x, measureStart.y).svgX} y1={toSvg(measureStart.x, measureStart.y).svgY} x2={toSvg(measureEnd.x, measureEnd.y).svgX} y2={toSvg(measureEnd.x, measureEnd.y).svgY} stroke={colors.select} strokeWidth={2 * (viewBox.w/1000)} strokeDasharray="5,5"/>
                     <text x={toSvg((measureStart.x+measureEnd.x)/2, (measureStart.y+measureEnd.y)/2).svgX} y={toSvg((measureStart.x+measureEnd.x)/2, (measureStart.y+measureEnd.y)/2).svgY} fill={colors.select} fontSize={14 * (viewBox.w/1000)} dy="-10" textAnchor="middle" fontWeight="bold">{dist.toFixed(3)}m</text>
                   </g>
                )}
                
                <polyline points={points.map(p => { const {svgX,svgY} = toSvg(p.x, p.y); return `${svgX},${svgY}`; }).join(' ')} fill="none" stroke={colors.line} strokeWidth={layerConfig.lineWidth * (viewBox.w/1000)} strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
                {points.map(p => {
                    const { svgX, svgY } = toSvg(p.x, p.y);
                    const isSelected = selectedIds.has(p.id);
                    const isMoving = movingId === p.id;
                    const isHover = hoverPoint?.id === p.id;
                    const r = layerConfig.pointSize * (viewBox.w/1000);
                    
                    // Visual Feedback for Moving
                    const moveStyle = isMoving ? { opacity: 0.7, stroke: '#fbbf24', strokeWidth: 2 * (viewBox.w/1000), fill: 'transparent' } : {};

                    return (
                        <g key={p.id} className="group">
                             {/* Ghost at original position */}
                             {isMoving && originalPos && (
                                 <circle cx={toSvg(originalPos.x, originalPos.y).svgX} cy={toSvg(originalPos.x, originalPos.y).svgY} r={r} fill={colors.point} opacity={0.3} strokeDasharray="2,2" stroke={colors.text} strokeWidth={1 * (viewBox.w/1000)}/>
                             )}
                             <circle cx={svgX} cy={svgY} r={isSelected ? r * 1.5 : r} 
                                     fill={isSelected ? colors.select : isMoving ? '#fbbf24' : isHover ? colors.hover : colors.point} 
                                     stroke={isMoving ? '#fff' : (isDark ? 'black' : 'white')} strokeWidth={isMoving ? 2 * (viewBox.w/1000) : 1 * (viewBox.w/1000)}
                                     onMouseEnter={() => setHoverPoint(p)} onMouseLeave={() => setHoverPoint(null)}
                                     style={{ transition: 'r 0.2s, fill 0.2s' }}
                             />
                             {/* Dashed halo when moving */}
                             {isMoving && (
                                 <circle cx={svgX} cy={svgY} r={r * 2} fill="none" stroke={colors.select} strokeWidth={1 * (viewBox.w/1000)} strokeDasharray="4,2" className="animate-spin-slow"/>
                             )}
                             {layerConfig.showLabels && (
                                <text x={svgX} y={svgY} dy={-r*2} textAnchor="middle" fill={colors.text} fontSize={10 * (viewBox.w/1000)} className="font-mono font-bold select-none opacity-80">{p.id}</text>
                             )}
                        </g>
                    )
                })}
                {annotations.map(a => {
                    const { svgX, svgY } = toSvg(a.x, a.y);
                    const isMoving = movingId === a.id;
                    const isSelected = selectedIds.has(a.id);
                    return (
                        <g key={a.id}>
                            {isMoving && originalPos && (
                                <text x={toSvg(originalPos.x, originalPos.y).svgX} y={toSvg(originalPos.x, originalPos.y).svgY} fill={a.color} fontSize={a.size * (viewBox.w/1000)} textAnchor="middle" className="font-sans select-none opacity-30">{a.text}</text>
                            )}
                            <text x={svgX} y={svgY} fill={isMoving || isSelected ? colors.select : a.color} fontSize={a.size * (viewBox.w/1000)} textAnchor="middle" className={`font-sans select-none cursor-pointer ${isMoving ? 'opacity-70' : ''}`} style={{textShadow: isDark ? '0 1px 2px black' : '0 1px 2px white'}}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedIds(new Set([a.id]));
                                }}
                            >{a.text}</text>
                            {isMoving && (
                                <rect x={svgX - (a.text.length * a.size * (viewBox.w/1000) * 0.3)} y={svgY - a.size * (viewBox.w/1000)} width={a.text.length * a.size * (viewBox.w/1000) * 0.6} height={a.size * (viewBox.w/1000)} fill="none" stroke={colors.select} strokeDasharray="2,2" />
                            )}
                        </g>
                    )
                })}
            </svg>

            {/* Point Tooltip */}
            {hoverPoint && (
              <div style={{left: mouseScreenCoords.x + 15, top: mouseScreenCoords.y + 15}} className="absolute z-50 pointer-events-none">
                 <div className={`p-2 rounded shadow-lg text-xs font-mono border backdrop-blur-md ${isDark ? 'bg-black/80 border-white/20 text-white' : 'bg-white/90 border-slate-300 text-slate-800'}`}>
                    <div className="font-bold text-cad-accent mb-1">{hoverPoint.id}</div>
                    <div>X: {hoverPoint.x.toFixed(3)}</div>
                    <div>Y: {hoverPoint.y.toFixed(3)}</div>
                    <div>Z: {hoverPoint.z.toFixed(3)}</div>
                    <div className="opacity-70 italic">{hoverPoint.desc}</div>
                 </div>
              </div>
            )}
            
            {/* Tool Tooltip */}
            {hoverTool && (
                <div style={{left: mouseScreenCoords.x + 10, top: mouseScreenCoords.y + 20}} className="absolute z-50 pointer-events-none animate-in fade-in duration-300">
                     <div className={`p-3 rounded-md shadow-xl text-xs border max-w-[200px] ${isDark ? 'bg-[#27272a] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}>
                         <div className="font-bold uppercase tracking-wider mb-1 text-cad-accent">{hoverTool.name}</div>
                         <div className="opacity-80 leading-relaxed">{hoverTool.description}</div>
                     </div>
                </div>
            )}

            {/* Property Inspector (Dynamic based on selection) */}
            {selectionData && (
                <div className={`absolute top-4 right-4 w-64 rounded-lg shadow-cad backdrop-blur-md border animate-in slide-in-from-right-5 fade-in duration-200 z-30 ${isDark ? 'bg-[#18181b]/90 border-[#3f3f46] text-white' : 'bg-white/90 border-slate-200 text-slate-800'}`}>
                    {selectionData.type === 'points' && (
                        <>
                            <div className="h-8 flex items-center justify-between px-3 border-b border-inherit bg-opacity-50 bg-black/5">
                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Seleção: Pontos</span>
                                <Info size={12} className="opacity-50"/>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="flex justify-between items-baseline"><span className="text-xs opacity-60">Qtd</span><span className="font-mono font-bold">{selectionData.data.length}</span></div>
                                <div className="h-px bg-inherit opacity-20"></div>
                                {/* Basic Stats if > 2 */}
                                {selectionData.data.length > 2 && (
                                  <>
                                    <div className="flex justify-between items-baseline"><span className="text-xs opacity-60">Área (m²)</span><span className="font-mono font-bold text-cad-accent">{calculateArea(selectionData.data as SurveyPoint[]).toFixed(2)}</span></div>
                                    <div className="flex justify-between items-baseline"><span className="text-xs opacity-60">Perímetro</span><span className="font-mono font-bold text-emerald-500">{calculatePerimeter(selectionData.data as SurveyPoint[]).toFixed(2)} m</span></div>
                                  </>
                                )}
                            </div>
                        </>
                    )}

                    {selectionData.type === 'polygon' && (
                        <>
                             <div className="h-8 flex items-center justify-between px-3 border-b border-inherit bg-opacity-50 bg-black/5">
                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Lote: {(selectionData.data as SurveyPolygon).id}</span>
                                <Info size={12} className="opacity-50"/>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="flex justify-between items-baseline"><span className="text-xs opacity-60">Área (m²)</span><span className="font-mono font-bold text-cad-accent">{(selectionData.data as SurveyPolygon).area.toFixed(2)}</span></div>
                                <div className="flex justify-between items-baseline"><span className="text-xs opacity-60">Perímetro</span><span className="font-mono font-bold text-emerald-500">{(selectionData.data as SurveyPolygon).perimeter.toFixed(2)} m</span></div>
                                <div className="pt-2 border-t border-inherit border-opacity-20">
                                    <label className="text-[10px] opacity-60 block mb-1">Cor do Lote</label>
                                    <input type="color" value={(selectionData.data as SurveyPolygon).color} 
                                           onChange={(e) => {
                                               const updatedPolys = polygons.map(p => p.id === (selectionData.data as SurveyPolygon).id ? {...p, color: e.target.value} : p);
                                               setPolygons(updatedPolys);
                                           }}
                                           className="w-full h-6 rounded cursor-pointer"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {selectionData.type === 'annotation' && (
                        <>
                             <div className="h-8 flex items-center justify-between px-3 border-b border-inherit bg-opacity-50 bg-black/5">
                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Texto</span>
                                <TypeIcon size={12} className="opacity-50"/>
                            </div>
                            <div className="p-4 space-y-3">
                                <div>
                                    <label className="text-[10px] opacity-60 block mb-1">Conteúdo</label>
                                    <input type="text" value={(selectionData.data as MapAnnotation).text} 
                                           onChange={(e) => {
                                               const updatedAnnos = annotations.map(a => a.id === (selectionData.data as MapAnnotation).id ? {...a, text: e.target.value} : a);
                                               setAnnotations(updatedAnnos);
                                           }}
                                           className="w-full bg-black/10 border border-white/10 rounded px-2 py-1 text-xs"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                     <div>
                                         <label className="text-[10px] opacity-60 block mb-1">Tamanho</label>
                                         <input type="number" value={(selectionData.data as MapAnnotation).size}
                                                onChange={(e) => {
                                                    const updatedAnnos = annotations.map(a => a.id === (selectionData.data as MapAnnotation).id ? {...a, size: parseInt(e.target.value)} : a);
                                                    setAnnotations(updatedAnnos);
                                                }}
                                                className="w-full bg-black/10 border border-white/10 rounded px-2 py-1 text-xs"
                                         />
                                     </div>
                                     <div>
                                         <label className="text-[10px] opacity-60 block mb-1">Cor</label>
                                         <input type="color" value={(selectionData.data as MapAnnotation).color}
                                                onChange={(e) => {
                                                    const updatedAnnos = annotations.map(a => a.id === (selectionData.data as MapAnnotation).id ? {...a, color: e.target.value} : a);
                                                    setAnnotations(updatedAnnos);
                                                }}
                                                className="w-full h-6 rounded cursor-pointer"
                                         />
                                     </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
            
            <div className={`absolute bottom-0 inset-x-0 h-7 flex items-center justify-between px-3 text-[10px] font-mono select-none border-t ${isDark ? 'bg-cad-panel border-cad-border text-cad-muted' : 'bg-white border-slate-200 text-slate-500'}`}>
                 <div className="flex items-center space-x-4">
                     <span className="w-40">X: {cursorCoords.x.toFixed(3)} Y: {cursorCoords.y.toFixed(3)}</span>
                     <div className="h-3 w-px bg-current opacity-20"></div>
                     <button onClick={() => setSnapEnabled(!snapEnabled)} className={`uppercase font-bold hover:text-cad-accent ${snapEnabled ? 'text-cad-accent' : 'opacity-50'}`}>OSNAP</button>
                     <button onClick={() => setGridEnabled(!gridEnabled)} className={`uppercase font-bold hover:text-cad-accent ${gridEnabled ? 'text-cad-accent' : 'opacity-50'}`}>GRID</button>
                 </div>
                 <div className="flex items-center space-x-2">
                     <span className="opacity-70">ESCALA 1:{(1000/viewBox.w * 100).toFixed(0)}</span>
                     <div className="h-3 w-px bg-current opacity-20"></div>
                     <span className="font-bold text-cad-accent">{activeTool.toUpperCase()}</span>
                 </div>
            </div>
            {activeTool === 'area' && areaPoints.length > 2 && (
                <div className="absolute top-4 left-4 z-40">
                     <button onClick={handleFinishArea} className="bg-emerald-600 text-white px-3 py-1.5 rounded shadow-lg text-xs font-bold hover:bg-emerald-500 flex items-center gap-2"><CheckCircle2 size={14}/> Finalizar Área</button>
                </div>
            )}

            {/* Manual Point Modal */}
            {showPointModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className={`w-64 p-4 rounded shadow-2xl border ${isDark ? 'bg-[#27272a] border-white/20' : 'bg-white border-slate-200'}`}>
                        <h4 className="text-xs font-bold uppercase mb-3">Inserir Ponto</h4>
                        <div className="space-y-2">
                            <input placeholder="Coord X" className="w-full text-xs p-1 rounded border bg-transparent" value={newPointData.x} onChange={e => setNewPointData({...newPointData, x: e.target.value})} autoFocus/>
                            <input placeholder="Coord Y" className="w-full text-xs p-1 rounded border bg-transparent" value={newPointData.y} onChange={e => setNewPointData({...newPointData, y: e.target.value})}/>
                            <input placeholder="Cota Z" className="w-full text-xs p-1 rounded border bg-transparent" value={newPointData.z} onChange={e => setNewPointData({...newPointData, z: e.target.value})}/>
                            <input placeholder="Descrição" className="w-full text-xs p-1 rounded border bg-transparent" value={newPointData.desc} onChange={e => setNewPointData({...newPointData, desc: e.target.value})}/>
                            <div className="flex gap-2 pt-2">
                                <button onClick={() => setShowPointModal(false)} className="flex-1 py-1 text-xs opacity-60 hover:opacity-100">Cancelar</button>
                                <button onClick={handleManualAddPoint} className="flex-1 py-1 bg-cad-accent text-white text-xs font-bold rounded">Adicionar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
         </div>
      </div>
    </div>
  );
};

// --- Version Control Modal ---
const VersionControlModal = ({ currentData, onLoad, onClose, theme }: any) => {
    const isDark = theme === 'dark';
    const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
    const [newName, setNewName] = useState('');

    useEffect(() => {
        const saved = localStorage.getItem('geoPro_snapshots');
        if (saved) setSnapshots(JSON.parse(saved));
    }, []);

    const saveSnapshot = () => {
        if (!newName.trim()) return;
        const newSnapshot: ProjectSnapshot = {
            id: Date.now().toString(),
            name: newName,
            date: Date.now(),
            data: currentData
        };
        const updated = [newSnapshot, ...snapshots];
        setSnapshots(updated);
        localStorage.setItem('geoPro_snapshots', JSON.stringify(updated));
        setNewName('');
    };

    const deleteSnapshot = (id: string) => {
        const updated = snapshots.filter(s => s.id !== id);
        setSnapshots(updated);
        localStorage.setItem('geoPro_snapshots', JSON.stringify(updated));
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh] border animate-in fade-in zoom-in-95 ${isDark ? 'bg-cad-panel border-cad-border text-cad-text' : 'bg-white border-slate-200 text-slate-900'}`}>
                <div className="p-4 border-b border-inherit flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2"><Clock size={18}/> Versões do Projeto</h3>
                    <button onClick={onClose}><Trash2 size={18} className="opacity-0 pointer-events-none" /></button> {/* Hidden for layout */}
                    <button onClick={onClose} className="opacity-50 hover:opacity-100">✕</button>
                </div>
                <div className="p-4 border-b border-inherit bg-opacity-50 bg-black/5">
                    <div className="flex gap-2">
                        <input 
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Nome da versão (ex: Final Rev 1)"
                            className={`flex-1 px-3 py-2 text-sm rounded border ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-slate-300'}`}
                        />
                        <button onClick={saveSnapshot} className="bg-cad-accent text-white px-4 py-2 rounded text-sm font-bold hover:brightness-110">Salvar</button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-4 space-y-2">
                    {snapshots.length === 0 && <div className="text-center opacity-50 text-sm py-4">Nenhuma versão salva.</div>}
                    {snapshots.map(snap => (
                        <div key={snap.id} className={`p-3 rounded border flex justify-between items-center group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <div>
                                <div className="font-bold text-sm">{snap.name}</div>
                                <div className="text-xs opacity-60">{new Date(snap.date).toLocaleString()} • {snap.data.points.length} pts</div>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onLoad(snap)} className="p-1.5 hover:bg-cad-accent/20 hover:text-cad-accent rounded" title="Carregar"><Upload size={14}/></button>
                                <button onClick={() => deleteSnapshot(snap.id)} className="p-1.5 hover:bg-red-500/20 hover:text-red-500 rounded" title="Excluir"><Trash2 size={14}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- Memorial Generator ---
const MemorialGenerator = ({ metadata, points, polygons, selectedIds, theme }: any) => {
    const isDark = theme === 'dark';
    const [reportText, setReportText] = useState('');

    useEffect(() => {
        let text = `MEMORIAL DESCRITIVO\n\n`;
        text += `PROJETO: ${metadata.title.toUpperCase()}\n`;
        text += `LOCAL: ${metadata.location}\n`;
        text += `PROPRIETÁRIO: ${metadata.owner}\n`;
        text += `RESP. TÉCNICO: ${metadata.professional} (CREA: ${metadata.crea})\n`;
        text += `DATA: ${new Date().toLocaleDateString()}\n`;
        text += `------------------------------------------------------------\n\n`;

        // Determine if we are describing a polygon or just a sequence of points
        const selectedPoly = polygons.find((p: any) => selectedIds.has(p.id));
        
        if (selectedPoly) {
            text += `DESCRIÇÃO PERIMÉTRICA - ${selectedPoly.id.toUpperCase()}\n\n`;
            text += `Inicia-se a descrição deste perímetro no vértice inicial, de coordenadas N=${selectedPoly.points[0].y.toFixed(3)}m e E=${selectedPoly.points[0].x.toFixed(3)}m.\n`;
            
            for (let i = 0; i < selectedPoly.points.length; i++) {
                const current = selectedPoly.points[i];
                const next = selectedPoly.points[(i + 1) % selectedPoly.points.length];
                const dist = Math.sqrt((next.x - current.x)**2 + (next.y - current.y)**2);
                const az = calculateAzimuth(current, next);
                
                text += `Deste, segue com azimute de ${toDMS(az)} e distância de ${dist.toFixed(2)}m até o vértice seguinte (N=${next.y.toFixed(3)}m, E=${next.x.toFixed(3)}m).\n`;
            }
            text += `\nÁrea Total: ${(selectedPoly.area/10000).toFixed(4)} ha (${selectedPoly.area.toFixed(2)} m²).\n`;
            text += `Perímetro: ${selectedPoly.perimeter.toFixed(2)} m.\n`;
        } else {
            text += `LISTAGEM DE COORDENADAS\n\n`;
            text += `VÉRTICE\t\tESTE (X)\t\tNORTE (Y)\t\tCOTA (Z)\tDESCRIÇÃO\n`;
            points.forEach((p: any) => {
                text += `${p.id.padEnd(10)}\t${p.x.toFixed(3)}\t${p.y.toFixed(3)}\t${p.z.toFixed(3)}\t${p.desc}\n`;
            });
        }

        setReportText(text);
    }, [metadata, points, polygons, selectedIds]);

    const downloadReport = () => {
        const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Memorial_${metadata.title.replace(/\s+/g, '_')}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className={`h-full flex flex-col p-6 ${isDark ? 'bg-cad-bg text-cad-text' : 'bg-slate-50 text-slate-800'}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg flex items-center gap-2"><FileText size={20} className="text-cad-accent"/> Memorial Descritivo Simplificado</h3>
                <button onClick={downloadReport} className="bg-cad-accent text-white px-4 py-2 rounded text-sm font-bold hover:brightness-110 flex items-center gap-2"><Download size={16}/> Baixar .TXT</button>
            </div>
            <div className={`flex-1 border rounded-lg p-4 font-mono text-xs overflow-auto whitespace-pre-wrap leading-relaxed ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-slate-200'}`}>
                {reportText}
            </div>
            <div className="mt-4 text-xs opacity-50 text-center">
                * Selecione um polígono no mapa para gerar a descrição perimétrica (azimutes e distâncias). Caso contrário, será listada a tabela de coordenadas.
            </div>
        </div>
    );
};

// --- Helper Components & Restored Full Components ---

const ToolGroup = ({ children }: any) => <div className="flex gap-1">{children}</div>;
const Separator = ({ theme }: any) => <div className={`w-px h-5 mx-1 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-300'}`}></div>;
const ToolbarBtn = ({ icon, active, onClick, name, desc, disabled, theme, onHover }: any) => {
    const isDark = theme === 'dark';
    return (
        <button 
            onClick={onClick} 
            disabled={disabled} 
            onMouseEnter={() => onHover && onHover({name, description: desc})}
            onMouseLeave={() => onHover && onHover(null)}
            className={`p-1.5 rounded transition-colors duration-150 flex items-center justify-center ${disabled ? 'opacity-30 cursor-not-allowed' : ''} ${active ? (isDark ? 'bg-cad-accent text-white shadow-glow' : 'bg-blue-100 text-blue-700') : (isDark ? 'text-cad-muted hover:text-white hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')}`}
        >
            {icon}
        </button>
    )
};
const NavBtn = ({ active, onClick, icon, label, theme }: any) => {
    const isDark = theme === 'dark';
    return (
        <button onClick={onClick} className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-xs font-medium transition-all ${active ? (isDark ? 'bg-cad-accent/10 text-cad-accent border border-cad-accent/20' : 'bg-brand-50 text-brand-700 border border-brand-200') : (isDark ? 'text-cad-muted hover:bg-white/5 hover:text-white' : 'text-slate-500 hover:bg-slate-50')}`}>{icon}<span>{label}</span></button>
    )
}

const ResizableTh = ({ width, onResize, children, className }: any) => {
  return (
    <th style={{ width }} className={`relative group ${className}`}>
      {children}
      <div 
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cad-accent group-hover:bg-white/20 transition-colors z-20"
        onMouseDown={onResize}
      />
    </th>
  );
};

const DataEditor = ({ points, setPoints, metadata, setMetadata, selectedIds, setSelectedIds, theme }: any) => {
    const isDark = theme === 'dark';
    const [colWidths, setColWidths] = useState({ id: 80, x: 100, y: 100, z: 80, desc: 150 });
    const [zBase, setZBase] = useState(0);
    const [zMult, setZMult] = useState(1);
    
    // Resize Logic
    const startResize = (e: React.MouseEvent, col: keyof typeof colWidths) => {
        const startX = e.clientX;
        const startWidth = colWidths[col];
        const onMove = (mv: MouseEvent) => {
            setColWidths(prev => ({ ...prev, [col]: Math.max(50, startWidth + (mv.clientX - startX)) }));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const applyZTransform = () => {
        if (confirm(`Aplicar transformação em TODOS os ${points.length} pontos?\nNovo Z = (Z * ${zMult}) + ${zBase}`)) {
            const newPoints = points.map((p: SurveyPoint) => ({
                ...p,
                z: (p.z * zMult) + zBase
            }));
            setPoints(newPoints);
        }
    };

    const handlePointChange = (idx: number, field: keyof SurveyPoint, value: any) => {
        const newPoints = [...points];
        newPoints[idx] = { ...newPoints[idx], [field]: value };
        setPoints(newPoints);
    };
    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const exportCSV = () => {
        const pointsToExport = selectedIds.size > 0 
            ? points.filter((p: any) => selectedIds.has(p.id)) 
            : points;
        
        let csv = "ID,X,Y,Z,DESCRIÇÃO\n";
        pointsToExport.forEach((p: any) => {
            csv += `${p.id},${p.x},${p.y},${p.z},${p.desc}\n`;
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `${metadata.title.replace(/\s+/g, '_')}_${dateStr}.csv`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className={`h-full flex flex-col ${isDark ? 'bg-cad-bg' : 'bg-slate-50'}`}>
            <div className={`h-12 border-b flex items-center justify-between px-4 gap-4 ${isDark ? 'bg-cad-panel border-cad-border text-cad-text' : 'bg-white border-slate-200'}`}>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase opacity-60">Z Global:</span>
                    <div className="flex items-center gap-1 bg-black/10 rounded p-1">
                        <label className="text-[10px] opacity-50 px-1">Offset</label>
                        <input type="number" value={zBase} onChange={e => setZBase(parseFloat(e.target.value))} className="w-16 bg-transparent text-xs font-mono focus:outline-none"/>
                    </div>
                    <div className="flex items-center gap-1 bg-black/10 rounded p-1">
                        <label className="text-[10px] opacity-50 px-1">Fator</label>
                        <input type="number" value={zMult} onChange={e => setZMult(parseFloat(e.target.value))} className="w-12 bg-transparent text-xs font-mono focus:outline-none"/>
                    </div>
                    <button onClick={applyZTransform} className="bg-cad-accent text-white px-3 py-1 rounded text-xs font-bold hover:brightness-110">Aplicar</button>
                </div>
                <button onClick={exportCSV} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition ${isDark ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-white hover:bg-slate-50 border shadow-sm text-slate-700'}`}>
                    <FileSpreadsheet size={14} className="text-green-500"/> Exportar CSV
                </button>
            </div>
            
            <div className={`flex-1 overflow-auto p-0`}>
                <table className={`w-full text-sm text-left border-collapse table-fixed ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                    <thead className={`text-xs uppercase sticky top-0 z-10 ${isDark ? 'bg-cad-panel text-gray-400' : 'bg-slate-50 text-slate-500'}`}>
                        <tr>
                            <ResizableTh width={40} className="p-3 text-center"><input type="checkbox" checked={selectedIds.size === points.length && points.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(points.map((p:any) => p.id)) : new Set())}/></ResizableTh>
                            <ResizableTh width={colWidths.id} onResize={(e: any) => startResize(e, 'id')} className="p-3 font-semibold">ID</ResizableTh>
                            <ResizableTh width={colWidths.x} onResize={(e: any) => startResize(e, 'x')} className="p-3 font-semibold">Este (X)</ResizableTh>
                            <ResizableTh width={colWidths.y} onResize={(e: any) => startResize(e, 'y')} className="p-3 font-semibold">Norte (Y)</ResizableTh>
                            <ResizableTh width={colWidths.z} onResize={(e: any) => startResize(e, 'z')} className="p-3 font-semibold">Cota (Z)</ResizableTh>
                            <ResizableTh width={colWidths.desc} onResize={(e: any) => startResize(e, 'desc')} className="p-3 font-semibold">Descrição</ResizableTh>
                        </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-white/10' : 'divide-slate-100'} ${isDark ? 'bg-cad-bg' : 'bg-white'}`}>
                        {points.map((p: SurveyPoint, i: number) => (
                            <tr key={i} className={`${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'} transition ${selectedIds.has(p.id) ? (isDark ? 'bg-cad-accent/10' : 'bg-brand-50/50') : ''}`}>
                                <td className="p-3 text-center"><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)}/></td>
                                <td className="p-3"><input className="w-full bg-transparent border-none focus:ring-0 p-0 font-medium" value={p.id} onChange={(e) => handlePointChange(i, 'id', e.target.value)} /></td>
                                <td className="p-3"><input type="number" className="w-full bg-transparent border-none focus:ring-0 p-0 font-mono opacity-80" value={p.x} onChange={(e) => handlePointChange(i, 'x', parseFloat(e.target.value))} /></td>
                                <td className="p-3"><input type="number" className="w-full bg-transparent border-none focus:ring-0 p-0 font-mono opacity-80" value={p.y} onChange={(e) => handlePointChange(i, 'y', parseFloat(e.target.value))} /></td>
                                <td className="p-3"><input type="number" className="w-full bg-transparent border-none focus:ring-0 p-0 font-mono opacity-80" value={p.z} onChange={(e) => handlePointChange(i, 'z', parseFloat(e.target.value))} /></td>
                                <td className="p-3"><input className="w-full bg-transparent border-none focus:ring-0 p-0 opacity-70" value={p.desc} onChange={(e) => handlePointChange(i, 'desc', e.target.value)} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const View3D = ({ points, theme }: { points: SurveyPoint[], theme: 'light' | 'dark' }) => {
    const isDark = theme === 'dark';
    const [visibleCategories, setVisibleCategories] = useState<Set<string>>(new Set());
    const [categoryColors, setCategoryColors] = useState<Record<string, string>>({});
    
    // Extract unique descriptions for filtering
    const categories = useMemo(() => Array.from(new Set(points.map(p => p.desc || 'Sem Descrição'))), [points]);
    
    // Initialize colors
    useEffect(() => {
        const newColors = { ...categoryColors };
        let changed = false;
        categories.forEach((cat, idx) => {
             if (!newColors[cat]) {
                 // Generate a deterministic pastel color
                 const hue = (idx * 137.508) % 360; 
                 newColors[cat] = `hsl(${hue}, 70%, 60%)`;
                 changed = true;
             }
        });
        if (changed) setCategoryColors(newColors);
        if (visibleCategories.size === 0 && categories.length > 0) {
            setVisibleCategories(new Set(categories));
        }
    }, [categories]);

    const toggleCategory = (cat: string) => {
        const newSet = new Set(visibleCategories);
        if (newSet.has(cat)) newSet.delete(cat); else newSet.add(cat);
        setVisibleCategories(newSet);
    }
    
    const changeColor = (cat: string, color: string) => {
        setCategoryColors(prev => ({...prev, [cat]: color}));
    }

    const filteredPoints = useMemo(() => points.filter(p => visibleCategories.has(p.desc || 'Sem Descrição')), [points, visibleCategories]);

    const centroid = useMemo(() => {
        if (filteredPoints.length === 0) return { x: 0, y: 0, z: 0 };
        const xs = filteredPoints.map(p => p.x); const ys = filteredPoints.map(p => p.y); const zs = filteredPoints.map(p => p.z);
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    }, [filteredPoints]);

    const normalizedPoints = useMemo(() => filteredPoints.map(p => ({ ...p, x: p.x - centroid.x, y: p.y - centroid.y, z: (p.z - centroid.z) * 2 })), [filteredPoints, centroid]);

    return (
        <div className={`w-full h-full relative ${isDark ? 'bg-black' : 'bg-slate-100'}`}>
             <div className="absolute top-4 left-4 z-10 bg-black/50 p-3 rounded backdrop-blur-sm border border-white/10 w-64 max-h-[80vh] overflow-y-auto">
                 <div className="text-white text-xs font-bold uppercase mb-2 flex items-center gap-2"><Filter size={12}/> Camadas & Cores</div>
                 <div className="space-y-1">
                     {categories.map(cat => (
                         <div key={cat} className="flex items-center justify-between group">
                             <label className="flex items-center space-x-2 text-white/80 text-xs cursor-pointer hover:text-white flex-1">
                                 <input type="checkbox" checked={visibleCategories.has(cat)} onChange={() => toggleCategory(cat)} className="rounded bg-white/20 border-none"/>
                                 <span className="truncate">{cat}</span>
                             </label>
                             <div className="relative w-4 h-4 overflow-hidden rounded-full border border-white/30 hover:border-white">
                                 <input type="color" value={categoryColors[cat] || '#ffffff'} onChange={(e) => changeColor(cat, e.target.value)} className="absolute -top-1 -left-1 w-6 h-6 p-0 border-none cursor-pointer" />
                             </div>
                         </div>
                     ))}
                 </div>
             </div>

             <Canvas camera={{ position: [50, 50, 50], fov: 45 }}>
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <OrbitControls makeDefault />
                <GizmoHelper alignment="bottom-right" margin={[80, 80]}><GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" /></GizmoHelper>
                <gridHelper args={[200, 20]} position={[0, -10, 0]} />
                <group>
                    {normalizedPoints.map((p, i) => (
                        <group key={i} position={[p.x, p.z, -p.y]}>
                             <mesh>
                                 <sphereGeometry args={[0.5, 16, 16]} />
                                 <meshStandardMaterial color={categoryColors[p.desc || 'Sem Descrição'] || '#fbbf24'} />
                             </mesh>
                        </group>
                    ))}
                    {normalizedPoints.length > 1 && <Line points={normalizedPoints.map(p => [p.x, p.z, -p.y] as [number, number, number])} color="#3b82f6" lineWidth={2} />}
                </group>
             </Canvas>
        </div>
    );
};

const ElevationProfile = ({ points, theme }: { points: SurveyPoint[], theme: 'light' | 'dark' }) => {
    const isDark = theme === 'dark';
    const chartRef = useRef<HTMLDivElement>(null);
    const data = useMemo(() => {
        let dist = 0;
        return points.map((p, i) => {
            if (i > 0) { const prev = points[i-1]; dist += Math.sqrt((p.x - prev.x)**2 + (p.y - prev.y)**2); }
            return { name: p.id, dist, z: p.z };
        });
    }, [points]);

    const downloadChart = () => {
        if (chartRef.current) {
            const svg = chartRef.current.querySelector('svg');
            if (svg) {
                const svgData = new XMLSerializer().serializeToString(svg);
                const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'perfil_elevacao.svg';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
    }

    return (
        <div className={`h-full w-full p-6 flex flex-col ${isDark ? 'bg-cad-bg text-white' : 'bg-slate-50 text-slate-800'}`}>
            <div className={`p-6 rounded-xl border shadow-sm flex-1 flex flex-col ${isDark ? 'bg-cad-panel border-cad-border' : 'bg-white border-slate-200'}`}>
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2"><BarChartBig className="text-cad-accent"/> Perfil Altimétrico</h3>
                    <button onClick={downloadChart} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-cad-accent text-white rounded hover:brightness-110"><ImageIcon size={14}/> Exportar SVG</button>
                 </div>
                 <div className="flex-1 w-full min-h-0" ref={chartRef}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorZ" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="dist" tickFormatter={(v) => `${v.toFixed(0)}m`} stroke={isDark ? "#52525b" : "#94a3b8"} fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis domain={['auto', 'auto']} stroke={isDark ? "#52525b" : "#94a3b8"} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}m`}/>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#27272a" : "#e2e8f0"}/>
                            <RechartsTooltip contentStyle={{backgroundColor: isDark ? '#18181b' : '#fff', borderColor: isDark ? '#3f3f46' : '#e2e8f0', color: isDark ? '#fff' : '#000'}} itemStyle={{color: isDark ? '#fff' : '#000'}} formatter={(value: number) => [`${value.toFixed(2)} m`, 'Elevação']} labelFormatter={(label) => `Distância: ${parseFloat(label).toFixed(2)} m`}/>
                            <Area type="monotone" dataKey="z" stroke="#06b6d4" strokeWidth={3} fillOpacity={1} fill="url(#colorZ)" activeDot={{r: 6, strokeWidth: 0}} />
                        </AreaChart>
                    </ResponsiveContainer>
                 </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);