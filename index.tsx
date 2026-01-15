import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html, Line, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { 
  Map as MapIcon, 
  FileText, 
  Upload, 
  Settings, 
  Layers, 
  Download, 
  Plus, 
  Trash2,
  Globe,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Move,
  ZoomIn,
  ZoomOut,
  Save,
  FolderOpen,
  Box,
  Ruler,
  Grid as GridIcon,
  Copy,
  Crosshair,
  BarChartBig,
  Eye,
  ClipboardCheck,
  MousePointer2,
  CheckSquare,
  Square,
  ArrowRight,
  Hand,
  Circle,
  Maximize,
  Magnet,
  MousePointer,
  Trash,
  Undo,
  Redo,
  MoreVertical,
  Minus,
  Pentagon,
  Video,
  Camera,
  RotateCcw,
  Type as TypeIcon,
  Palette,
  FileUp
} from 'lucide-react';

// --- Types ---

interface SurveyPoint {
  id: string;
  x: number; // Easting
  y: number; // Northing
  z: number; // Elevation
  desc: string;
}

interface MapAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

interface ProjectMetadata {
  title: string;
  owner: string;
  location: string;
  registryId: string; // Matrícula
  professional: string; // Responsável Técnico
  crea: string;
  utmZone: string; // e.g. "23S"
}

interface MapViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ColumnMapping {
  id: number;
  x: number;
  y: number;
  z: number;
  desc: number;
  delimiter: string;
}

interface LayerConfig {
  pointColor: string;
  selectedColor: string;
  lineColor: string;
  lineWidth: number;
  pointSize: number;
  showLabels: boolean;
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

const formatCoord = (num: number) => num.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// --- Components ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'map' | 'data' | 'memorial' | '3d' | 'charts'>('data');
  
  // Data State
  const [points, setPoints] = useState<SurveyPoint[]>([
    { id: 'M-01', x: 250100.500, y: 7450100.200, z: 750.00, desc: 'Marco de Concreto' },
    { id: 'M-02', x: 250250.000, y: 7450120.500, z: 752.10, desc: 'Cerca de Arame' },
    { id: 'M-03', x: 250280.300, y: 7449980.100, z: 748.50, desc: 'Vértice Natural' },
    { id: 'M-04', x: 250090.100, y: 7449950.000, z: 749.20, desc: 'Divisa com Estrada' },
  ]);
  
  const [annotations, setAnnotations] = useState<MapAnnotation[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Undo/Redo State
  const [history, setHistory] = useState<{points: SurveyPoint[], annotations: MapAnnotation[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Helper to push state to history
  const pushToHistory = useCallback((newPoints: SurveyPoint[], newAnnotations: MapAnnotation[]) => {
      const currentEntry = { points: newPoints, annotations: newAnnotations };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentEntry);
      
      // Limit history size
      if (newHistory.length > 50) newHistory.shift();
      
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Initial history push
  useEffect(() => {
    if (history.length === 0) {
        setHistory([{ points, annotations }]);
        setHistoryIndex(0);
    }
  }, []);

  const updateStateWithHistory = (newPoints: SurveyPoint[], newAnnotations: MapAnnotation[] = annotations) => {
      pushToHistory(newPoints, newAnnotations);
      setPoints(newPoints);
      setAnnotations(newAnnotations);
  };

  const undo = () => {
      if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          const entry = history[prevIndex];
          setPoints(entry.points);
          setAnnotations(entry.annotations);
          setHistoryIndex(prevIndex);
      }
  };

  const redo = () => {
      if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const entry = history[nextIndex];
          setPoints(entry.points);
          setAnnotations(entry.annotations);
          setHistoryIndex(nextIndex);
      }
  };

  const [metadata, setMetadata] = useState<ProjectMetadata>({
    title: 'Levantamento Planimétrico Fazenda Santa Fé',
    owner: 'Agrícola Silva Ltda',
    location: 'Rio Verde, GO',
    registryId: '12.345',
    professional: 'Eng. Cartógrafo Ana Pereira',
    crea: '12345/D-GO',
    utmZone: '22S'
  });

  const [layerConfig, setLayerConfig] = useState<LayerConfig>({
    pointColor: '#2563eb', // brand-600
    selectedColor: '#dc2626', // red-600
    lineColor: '#3b82f6', // brand-500
    lineWidth: 2,
    pointSize: 4,
    showLabels: true,
  });

  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof ProjectMetadata, string>>>({});

  const [mapViewBox, setMapViewBox] = useState<MapViewBox>({ x: 0, y: 0, w: 1000, h: 1000 });
  const [mapStyle, setMapStyle] = useState<'tech' | 'satellite' | 'clean'>('tech');

  // Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [importMode, setImportMode] = useState<'ai' | 'manual'>('ai');
  const [manualMapping, setManualMapping] = useState<ColumnMapping>({ id: 0, x: 1, y: 2, z: 3, desc: 4, delimiter: ',' });

  const [generatedContent, setGeneratedContent] = useState('');

  const area = useMemo(() => calculateArea(points), [points]);
  const perimeter = useMemo(() => calculatePerimeter(points), [points]);

  // Validation Logic
  const validateMetadata = () => {
    const errors: Partial<Record<keyof ProjectMetadata, string>> = {};
    if (!metadata.title) errors.title = "Título é obrigatório.";
    if (!metadata.owner) errors.owner = "Proprietário é obrigatório.";
    if (!metadata.location) errors.location = "Localização é obrigatória.";
    
    // UTM Zone Validation (e.g., "22S", "23N")
    const utmRegex = /^\d{1,2}[NSns]$/;
    if (!metadata.utmZone) {
      errors.utmZone = "Zona UTM é obrigatória.";
    } else if (!utmRegex.test(metadata.utmZone)) {
      errors.utmZone = "Formato inválido (Ex: 23S).";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveProject = () => {
    if (!validateMetadata()) {
      alert('❌ Corrija os erros no formulário de metadados antes de salvar.');
      setActiveTab('data'); // Go to data tab so user sees errors
      return;
    }

    try {
      const projectData = { points, annotations, metadata, generatedContent, viewState: { mapViewBox, mapStyle }, layerConfig };
      localStorage.setItem('geoProProject', JSON.stringify(projectData));
      alert('✅ Projeto salvo com sucesso!');
    } catch (e) {
      alert('❌ Erro ao salvar. Verifique o espaço disponível.');
    }
  };

  const loadProject = () => {
    const data = localStorage.getItem('geoProProject');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.points) {
             setPoints(parsed.points);
             pushToHistory(parsed.points, parsed.annotations || []); // Reset history with loaded state
        }
        if (parsed.annotations) setAnnotations(parsed.annotations);
        if (parsed.metadata) setMetadata(parsed.metadata);
        if (parsed.generatedContent) setGeneratedContent(parsed.generatedContent);
        if (parsed.viewState) {
          if (parsed.viewState.mapViewBox) setMapViewBox(parsed.viewState.mapViewBox);
          if (parsed.viewState.mapStyle) setMapStyle(parsed.viewState.mapStyle);
        }
        if (parsed.layerConfig) setLayerConfig(parsed.layerConfig);
        setValidationErrors({});
        alert('📂 Projeto carregado com sucesso!');
      } catch (e) {
        alert('❌ Erro ao ler dados do projeto.');
      }
    } else {
      alert('⚠️ Nenhum projeto salvo encontrado.');
    }
  };

  const handleManualImport = () => {
    if (!importText.trim()) return;
    try {
       const lines = importText.trim().split('\n');
       const newPoints: SurveyPoint[] = [];
       
       lines.forEach((line, index) => {
          if (line.trim() === '') return;
          // Handle different delimiters based on user selection logic or simple regex
          let cols: string[];
          if (manualMapping.delimiter === 'tab') cols = line.split('\t');
          else if (manualMapping.delimiter === 'space') cols = line.trim().split(/\s+/);
          else cols = line.split(manualMapping.delimiter);

          // Remove quotes if CSV
          cols = cols.map(c => c.replace(/^"|"$/g, '').trim());

          if (cols.length < 3) return; // Skip invalid lines

          const p: SurveyPoint = {
             id: cols[manualMapping.id] || `P${index + 1}`,
             x: parseFloat(cols[manualMapping.x]) || 0,
             y: parseFloat(cols[manualMapping.y]) || 0,
             z: parseFloat(cols[manualMapping.z]) || 0,
             desc: cols[manualMapping.desc] || ''
          };
          
          if (!isNaN(p.x) && !isNaN(p.y)) {
              newPoints.push(p);
          }
       });

       updateStateWithHistory(newPoints);
       setShowImportModal(false);
       setActiveTab('map');
    } catch (e) {
       alert("Erro na importação manual. Verifique o mapeamento das colunas.");
    }
  };

  const handleAIImport = async () => {
    if (!importText.trim()) return;
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Parse the following raw survey data into a strict JSON array of objects with keys: id (string), x (number), y (number), z (number), desc (string). 
        Format description: Identify point names, easting/X, northing/Y, elevation/Z, and descriptions. Handle various delimiters (space, tab, comma).
        Support formats from Leica, Trimble, Topcon, and standard CSV.
        If no Z is present, assume 0. If no ID is present, generate sequential IDs (P1, P2...).
        
        Input Data:
        ${importText}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                z: { type: Type.NUMBER },
                desc: { type: Type.STRING }
              }
            }
          }
        }
      });
      
      const newPoints = JSON.parse(response.text);
      if (Array.isArray(newPoints)) {
        updateStateWithHistory(newPoints);
        setShowImportModal(false);
        setActiveTab('map');
      }
    } catch (e) {
      console.error("Error parsing data", e);
      alert("Falha ao interpretar dados. Tente o modo manual.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleKMLUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          const text = event.target?.result as string;
          try {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(text, "text/xml");
              const placemarks = xmlDoc.getElementsByTagName("Placemark");
              const newPoints: SurveyPoint[] = [];

              for (let i = 0; i < placemarks.length; i++) {
                  const placemark = placemarks[i];
                  const name = placemark.getElementsByTagName("name")[0]?.textContent || `P${i+1}`;
                  const coordsStr = placemark.getElementsByTagName("coordinates")[0]?.textContent?.trim();
                  
                  if (coordsStr) {
                      const coords = coordsStr.split(',');
                      if (coords.length >= 2) {
                          // KML is usually Lon,Lat,Alt. We map to X,Y (assuming local projection or just using raw if user wants)
                          // Note: KML is Lat/Lon (WGS84). A real app would project to UTM.
                          // For this demo, we assume the user understands these are raw values or pre-projected.
                          // Or we simulate a simple projection multiplier for visibility if needed, but let's keep raw.
                          const x = parseFloat(coords[0]);
                          const y = parseFloat(coords[1]);
                          const z = parseFloat(coords[2]) || 0;
                          
                          // Simple check to see if it looks like Lat/Lon (small numbers) vs UTM (big numbers)
                          // If Lat/Lon, maybe multiply to visualize better on our cartesian grid?
                          // Let's just load raw.
                          newPoints.push({ id: name, x, y, z, desc: 'Importado de KML' });
                      }
                  }
              }
              if (newPoints.length > 0) {
                  updateStateWithHistory([...points, ...newPoints]);
                  alert(`${newPoints.length} pontos importados.`);
                  setActiveTab('map');
              } else {
                  alert("Nenhum ponto encontrado no KML.");
              }

          } catch (err) {
              alert("Erro ao ler arquivo KML.");
          }
      };
      reader.readAsText(file);
      // Reset input
      e.target.value = '';
  };

  const handleImport = () => {
    if (importMode === 'ai') handleAIImport();
    else handleManualImport();
  };

  const generateMemorial = async () => {
    if (!validateMetadata()) {
        alert("Preencha os metadados corretamente antes de gerar o memorial.");
        setActiveTab('data');
        return;
    }
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Atue como um Engenheiro Agrimensor sênior especialista em Georreferenciamento de Imóveis Rurais (Norma INCRA 3ª Edição).
      Escreva um Memorial Descritivo técnico completo para o imóvel abaixo.
      
      DADOS DO PROJETO:
      Proprietário: ${metadata.owner}
      Matrícula: ${metadata.registryId}
      Localização: ${metadata.location}
      Zona UTM: ${metadata.utmZone}
      Responsável Técnico: ${metadata.professional} (CREA: ${metadata.crea})
      Área Calculada: ${(area / 10000).toFixed(4)} ha
      Perímetro Calculado: ${perimeter.toFixed(2)} m
      
      COORDENADAS (Sistema Geodésico SIRGAS 2000, UTM):
      ${JSON.stringify(points)}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', 
        contents: prompt,
      });

      setGeneratedContent(response.text);
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar memorial.");
    } finally {
      setAiLoading(false);
    }
  };

  const generateKML = async () => {
    setAiLoading(true);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Gere um arquivo KML completo e válido.
        Zona UTM: ${metadata.utmZone}
        DADOS:
        ${JSON.stringify(points)}
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        const cleanKml = response.text.replace(/```xml/g, '').replace(/```/g, '').trim();
        const blob = new Blob([cleanKml], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `levantamento_${metadata.owner.replace(/\s+/g, '_')}.kml`;
        a.click();
    } catch (e) {
        alert("Erro ao gerar KML");
    } finally {
        setAiLoading(false);
    }
  };

  const exportCSV = (selectedIds: Set<string>) => {
    const pointsToExport = selectedIds.size > 0 
        ? points.filter(p => selectedIds.has(p.id))
        : points;

    const headers = "ID,X (Este),Y (Norte),Z (Cota),Descrição\n";
    const rows = pointsToExport.map(p => `${p.id},${p.x},${p.y},${p.z},${p.desc}`).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `pontos_${metadata.owner.replace(/\s+/g, '_')}${selectedIds.size > 0 ? '_selecao' : ''}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const flyToPoint = (p: SurveyPoint) => {
    const zoomLevel = 100; // Fixed zoom width in meters
    setMapViewBox({
        x: p.x - zoomLevel/2,
        y: p.y - zoomLevel/2,
        w: zoomLevel,
        h: zoomLevel
    });
    setActiveTab('map');
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 overflow-hidden font-sans">
      
      {/* Loading Overlay */}
      {aiLoading && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white animate-in fade-in">
           <div className="bg-white/10 p-4 rounded-full mb-4 ring-4 ring-white/20">
             <Cpu className="animate-spin" size={48} />
           </div>
           <h3 className="text-2xl font-bold tracking-tight mb-2">Processando com IA...</h3>
           <p className="text-slate-200 text-sm">Analisando dados e gerando resultados.</p>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col z-20 shadow-md">
        <div className="p-6 flex items-center space-x-3 border-b border-slate-100">
          <div className="bg-brand-600 p-2 rounded-lg text-white">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <span className="font-bold text-xl tracking-tight text-slate-900 block leading-none">GeoPro</span>
            <span className="text-[10px] text-brand-600 font-bold uppercase tracking-widest">Enterprise</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3">Ferramentas</div>
          <NavBtn active={activeTab === 'data'} onClick={() => setActiveTab('data')} icon={<Layers size={18} />} label="Dados & Pontos" />
          <NavBtn active={activeTab === 'map'} onClick={() => setActiveTab('map')} icon={<MapIcon size={18} />} label="Mapa Interativo" />
          <NavBtn active={activeTab === '3d'} onClick={() => setActiveTab('3d')} icon={<Box size={18} />} label="Visualização 3D" />
          <NavBtn active={activeTab === 'charts'} onClick={() => setActiveTab('charts')} icon={<BarChartBig size={18} />} label="Gráficos & Perfil" />
          <NavBtn active={activeTab === 'memorial'} onClick={() => setActiveTab('memorial')} icon={<FileText size={18} />} label="Memorial Descritivo" />
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-3 bg-slate-50/50">
          <div className="text-xs text-slate-500 uppercase font-semibold">Ações Rápidas</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={saveProject} className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-lg hover:border-brand-500 hover:text-brand-600 hover:shadow-md transition group">
              <Save size={18} className="mb-1 text-slate-400 group-hover:text-brand-500"/>
              <span className="text-[10px] font-medium">Salvar</span>
            </button>
            <button onClick={loadProject} className="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-lg hover:border-brand-500 hover:text-brand-600 hover:shadow-md transition group">
              <FolderOpen size={18} className="mb-1 text-slate-400 group-hover:text-brand-500"/>
              <span className="text-[10px] font-medium">Carregar</span>
            </button>
          </div>
        </div>

        <div className="p-5 bg-white border-t border-slate-100">
           <div className="space-y-4">
              <div className="flex justify-between items-center">
                 <span className="text-xs text-slate-500 font-medium">Área Total</span>
                 <span className="text-sm font-bold text-brand-700 bg-brand-50 px-2 py-1 rounded">{(area / 10000).toFixed(4)} ha</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                 <div className="bg-brand-500 h-full w-3/4 rounded-full"></div>
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-xs text-slate-500 font-medium">Perímetro</span>
                 <span className="text-xs font-mono text-slate-700">{perimeter.toFixed(2)} m</span>
              </div>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-slate-50">
        
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm z-10">
           <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-800 text-lg">{metadata.title}</h1>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold uppercase rounded border border-slate-200">Em Edição</span>
              </div>
              <span className="text-xs text-slate-400 font-medium mt-0.5 flex items-center gap-2">
                 <Globe size={10}/> {metadata.location || 'Sem localização definida'} 
                 <span className="text-slate-300">|</span> 
                 {points.length} Vértices
              </span>
           </div>
           <div className="flex items-center space-x-3">
             <label className="cursor-pointer flex items-center space-x-2 px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium transition shadow-sm">
                <FileUp size={16} />
                <span>KML</span>
                <input type="file" accept=".kml,.xml" className="hidden" onChange={handleKMLUpload} />
             </label>
             <button 
                onClick={() => setShowImportModal(true)} 
                className="flex items-center space-x-2 px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium transition shadow-sm"
             >
                <Upload size={16} />
                <span>Importar</span>
             </button>
             <button 
                onClick={generateKML} 
                disabled={aiLoading} 
                className="flex items-center space-x-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition shadow-md shadow-brand-200 disabled:opacity-50 disabled:shadow-none"
             >
                <Globe size={16} />
                <span>Exportar KML</span>
             </button>
           </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          
          {activeTab === 'data' && (
            <DataEditor 
                points={points} 
                setPoints={(newPoints: SurveyPoint[]) => updateStateWithHistory(newPoints)} 
                metadata={metadata} 
                setMetadata={setMetadata} 
                validationErrors={validationErrors}
                exportCSV={exportCSV} 
                flyToPoint={flyToPoint}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
            />
          )}

          {activeTab === 'map' && (
            <SurveyMap 
              points={points} 
              setPoints={(newPoints: SurveyPoint[]) => updateStateWithHistory(newPoints)}
              annotations={annotations}
              setAnnotations={(newAnnos: MapAnnotation[]) => updateStateWithHistory(points, newAnnos)}
              viewBox={mapViewBox} 
              setViewBox={setMapViewBox} 
              mapStyle={mapStyle} 
              setMapStyle={setMapStyle} 
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              undo={undo}
              redo={redo}
              canUndo={historyIndex > 0}
              canRedo={historyIndex < history.length - 1}
              openConfig={() => setShowConfigModal(true)}
              layerConfig={layerConfig}
            />
          )}

          {activeTab === '3d' && (
             <View3D points={points} />
          )}

          {activeTab === 'charts' && (
             <ElevationProfile points={points} />
          )}

          {activeTab === 'memorial' && (
            <div className="h-full flex flex-col p-8 max-w-5xl mx-auto w-full">
              <div className="mb-6 flex items-center justify-between bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div>
                   <h2 className="text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
                     <FileText className="text-brand-600"/>
                     Gerador de Memorial Descritivo
                   </h2>
                   <p className="text-sm text-slate-500">Documento compatível com SIGEF/INCRA (Norma 3ª Ed).</p>
                </div>
                <div className="flex space-x-3">
                    {generatedContent && (
                        <button 
                            onClick={() => {navigator.clipboard.writeText(generatedContent); alert("Copiado!")}}
                            className="flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 font-medium px-4 py-2.5 rounded-lg border border-slate-300 transition shadow-sm"
                        >
                            <Copy size={16}/> <span>Copiar Texto</span>
                        </button>
                    )}
                    <button 
                    onClick={generateMemorial} 
                    disabled={aiLoading}
                    className="flex items-center space-x-2 bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-2.5 rounded-lg shadow-lg shadow-brand-200 disabled:opacity-50 transition"
                    >
                    <FileText />
                    <span>Gerar Documento</span>
                    </button>
                </div>
              </div>
              
              <div className="flex-1 bg-white p-10 rounded-xl shadow-lg border border-slate-200 overflow-y-auto">
                {generatedContent ? (
                  <div className="prose prose-slate max-w-none font-serif leading-loose whitespace-pre-wrap text-slate-800">
                    {generatedContent}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                     <div className="p-6 bg-slate-50 rounded-full mb-4">
                        <FileText size={48} className="text-slate-300" />
                     </div>
                     <p className="italic text-lg text-slate-500">O memorial descritivo será exibido aqui.</p>
                     <p className="text-sm mt-2">Pressione "Gerar Documento" para iniciar.</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2"><Cpu size={24} className="text-brand-600"/> Importação de Pontos</h3>
               <button onClick={() => setShowImportModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition"><Trash2 size={20}/></button>
            </div>
            
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex space-x-4">
                <button 
                    onClick={() => setImportMode('ai')} 
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition ${importMode === 'ai' ? 'bg-white border-brand-500 text-brand-600 shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-200'}`}
                >
                    Detecção Automática (IA)
                </button>
                <button 
                    onClick={() => setImportMode('manual')} 
                    className={`flex-1 py-2 text-sm font-medium rounded-lg border transition ${importMode === 'manual' ? 'bg-white border-brand-500 text-brand-600 shadow-sm' : 'border-transparent text-slate-500 hover:bg-slate-200'}`}
                >
                    Mapeamento Manual
                </button>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-auto bg-white">
               {importMode === 'ai' ? (
                   <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800 flex items-start gap-3">
                        <AlertCircle className="shrink-0 mt-0.5" size={16}/>
                        <p>Cole os dados brutos. A IA tentará identificar automaticamente as colunas.</p>
                   </div>
               ) : (
                   <div className="space-y-3 mb-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="text-xs font-bold text-slate-500 uppercase">Configuração de Colunas (Índice Base 0)</div>
                        <div className="grid grid-cols-5 gap-2">
                             <div><label className="text-[10px] text-slate-400">ID</label><input type="number" className="w-full text-xs p-1 border rounded" value={manualMapping.id} onChange={(e) => setManualMapping({...manualMapping, id: parseInt(e.target.value)})}/></div>
                             <div><label className="text-[10px] text-slate-400">X (Este)</label><input type="number" className="w-full text-xs p-1 border rounded" value={manualMapping.x} onChange={(e) => setManualMapping({...manualMapping, x: parseInt(e.target.value)})}/></div>
                             <div><label className="text-[10px] text-slate-400">Y (Norte)</label><input type="number" className="w-full text-xs p-1 border rounded" value={manualMapping.y} onChange={(e) => setManualMapping({...manualMapping, y: parseInt(e.target.value)})}/></div>
                             <div><label className="text-[10px] text-slate-400">Z (Cota)</label><input type="number" className="w-full text-xs p-1 border rounded" value={manualMapping.z} onChange={(e) => setManualMapping({...manualMapping, z: parseInt(e.target.value)})}/></div>
                             <div><label className="text-[10px] text-slate-400">Desc</label><input type="number" className="w-full text-xs p-1 border rounded" value={manualMapping.desc} onChange={(e) => setManualMapping({...manualMapping, desc: parseInt(e.target.value)})}/></div>
                        </div>
                        <div className="mt-2">
                             <label className="text-[10px] text-slate-400 block mb-1">Separador</label>
                             <select className="w-full text-xs p-1 border rounded" value={manualMapping.delimiter} onChange={(e) => setManualMapping({...manualMapping, delimiter: e.target.value})}>
                                 <option value=",">Vírgula (,)</option>
                                 <option value=";">Ponto e Vírgula (;)</option>
                                 <option value="tab">Tabulação</option>
                                 <option value="space">Espaço</option>
                             </select>
                        </div>
                   </div>
               )}
               <textarea 
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full h-48 bg-slate-50 border border-slate-300 rounded-lg p-4 font-mono text-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none text-slate-700 resize-none shadow-sm"
                  placeholder={`Exemplo:
P1, 200.5, 500.2, 10, Marco
P2, 210.0, 505.0, 11, Cerca`}
               />
            </div>
            <div className="p-6 border-t border-slate-100 bg-white rounded-b-2xl flex justify-end space-x-3">
                 <button onClick={() => setShowImportModal(false)} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg transition text-sm font-medium">Cancelar</button>
                 <button 
                  onClick={handleImport}
                  disabled={aiLoading}
                  className="px-6 py-2.5 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 transition flex items-center space-x-2 text-sm shadow-lg shadow-brand-100"
                 >
                   <span>Importar Dados</span>
                 </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Configuration Modal */}
      {showConfigModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl p-6 border border-slate-200 animate-in fade-in zoom-in-95">
                  <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Palette size={20}/> Configuração Visual</h3>
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cor dos Pontos</label>
                          <div className="flex gap-2">
                             <input type="color" value={layerConfig.pointColor} onChange={(e) => setLayerConfig({...layerConfig, pointColor: e.target.value})} className="h-8 w-12 rounded cursor-pointer border-0 p-0"/>
                             <input type="text" value={layerConfig.pointColor} readOnly className="flex-1 bg-slate-50 border rounded px-2 text-xs font-mono text-slate-600"/>
                          </div>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cor das Linhas</label>
                          <div className="flex gap-2">
                             <input type="color" value={layerConfig.lineColor} onChange={(e) => setLayerConfig({...layerConfig, lineColor: e.target.value})} className="h-8 w-12 rounded cursor-pointer border-0 p-0"/>
                             <input type="text" value={layerConfig.lineColor} readOnly className="flex-1 bg-slate-50 border rounded px-2 text-xs font-mono text-slate-600"/>
                          </div>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Espessura da Linha: {layerConfig.lineWidth}px</label>
                          <input type="range" min="1" max="10" value={layerConfig.lineWidth} onChange={(e) => setLayerConfig({...layerConfig, lineWidth: parseInt(e.target.value)})} className="w-full accent-brand-600"/>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tamanho do Ponto: {layerConfig.pointSize}px</label>
                          <input type="range" min="2" max="12" value={layerConfig.pointSize} onChange={(e) => setLayerConfig({...layerConfig, pointSize: parseInt(e.target.value)})} className="w-full accent-brand-600"/>
                      </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                      <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800">Fechar</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

// --- Sub-Components ---

const NavBtn = ({ active, onClick, icon, label }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 group relative ${
      active 
      ? 'bg-brand-50 text-brand-700 font-semibold' 
      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`}
  >
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-brand-600 rounded-r-full"></div>}
    <div className={`${active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`}>{icon}</div>
    <span className="text-sm">{label}</span>
  </button>
);

const DataEditor = ({ points, setPoints, metadata, setMetadata, exportCSV, validationErrors, flyToPoint, selectedIds, setSelectedIds }: any) => {
  const addPoint = () => {
    const newId = `P${(points.length + 1).toString().padStart(2, '0')}`;
    setPoints([...points, { id: newId, x: 0, y: 0, z: 0, desc: '' }]);
  };

  const updatePoint = (index: number, field: keyof SurveyPoint, value: any) => {
    const newPoints = [...points];
    newPoints[index] = { ...newPoints[index], [field]: value };
    setPoints(newPoints);
  };

  const removePoint = (index: number) => {
    const newPoints = points.filter((_: any, i: number) => i !== index);
    setPoints(newPoints);
  };

  const toggleSelect = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
      if (selectedIds.size === points.length) setSelectedIds(new Set());
      else setSelectedIds(new Set(points.map((p: SurveyPoint) => p.id)));
  };

  const copyPoint = (p: SurveyPoint) => {
      const text = `ID: ${p.id} | X: ${p.x} | Y: ${p.y} | Z: ${p.z}`;
      navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      
      {/* Metadata Form */}
      <div className="p-8 pb-4">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center space-x-2 text-slate-800">
              <Settings size={18} className="text-brand-600" />
              <h3 className="font-bold text-base">Metadados do Projeto</h3>
            </div>
            <div className="flex gap-2">
                 {selectedIds.size > 0 && (
                     <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2 py-1.5 rounded flex items-center">
                        {selectedIds.size} selecionado(s)
                     </span>
                 )}
                <button onClick={() => exportCSV(selectedIds)} className="text-xs flex items-center gap-1.5 text-slate-600 hover:text-brand-600 hover:bg-brand-50 transition px-3 py-1.5 rounded-md font-medium border border-transparent hover:border-brand-200">
                <Download size={14}/> <span>{selectedIds.size > 0 ? 'Exportar Seleção' : 'Exportar CSV'}</span>
                </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Input label="Título do Projeto" value={metadata.title} onChange={(v: string) => setMetadata({...metadata, title: v})} error={validationErrors?.title} />
            <Input label="Proprietário" value={metadata.owner} onChange={(v: string) => setMetadata({...metadata, owner: v})} error={validationErrors?.owner} />
            <Input label="Matrícula/CNS" value={metadata.registryId} onChange={(v: string) => setMetadata({...metadata, registryId: v})} />
            <Input label="Localização" value={metadata.location} onChange={(v: string) => setMetadata({...metadata, location: v})} error={validationErrors?.location} />
            <Input label="Resp. Técnico" value={metadata.professional} onChange={(v: string) => setMetadata({...metadata, professional: v})} />
            <Input label="CREA/CFT" value={metadata.crea} onChange={(v: string) => setMetadata({...metadata, crea: v})} />
            <Input label="Zona UTM" placeholder="Ex: 23S" value={metadata.utmZone} onChange={(v: string) => setMetadata({...metadata, utmZone: v})} error={validationErrors?.utmZone} />
          </div>
        </div>
      </div>

      {/* Points Table */}
      <div className="flex-1 p-8 pt-0 overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-sm flex-1">
          <div className="p-4 px-6 border-b border-slate-200 flex justify-between items-center bg-white">
             <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Layers size={16} className="text-brand-600"/> Tabela de Coordenadas</h3>
             <button onClick={addPoint} className="flex items-center space-x-1.5 text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-2 rounded-lg transition border border-brand-200 font-semibold">
               <Plus size={14} /> <span>Adicionar Vértice</span>
             </button>
          </div>
          <div className="overflow-auto flex-1 custom-scrollbar">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 font-semibold tracking-wide shadow-sm">
                <tr>
                  <th className="px-4 py-4 border-b border-slate-200 w-10 text-center">
                      <button onClick={toggleSelectAll} className="text-slate-400 hover:text-brand-600">
                          {selectedIds.size === points.length && points.length > 0 ? <CheckSquare size={16}/> : <Square size={16}/>}
                      </button>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-200">Vértice</th>
                  <th className="px-6 py-4 border-b border-slate-200">Este (X)</th>
                  <th className="px-6 py-4 border-b border-slate-200">Norte (Y)</th>
                  <th className="px-6 py-4 border-b border-slate-200">Cota (Z)</th>
                  <th className="px-6 py-4 border-b border-slate-200">Descrição</th>
                  <th className="px-6 py-4 border-b border-slate-200 text-right">Ferramentas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-sm">
                {points.map((point: SurveyPoint, idx: number) => (
                  <tr key={idx} className={`hover:bg-slate-50 transition-colors group ${selectedIds.has(point.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleSelect(point.id)} className={`${selectedIds.has(point.id) ? 'text-brand-600' : 'text-slate-300 hover:text-slate-500'}`}>
                           {selectedIds.has(point.id) ? <CheckSquare size={16}/> : <Square size={16}/>}
                        </button>
                    </td>
                    <td className="px-6 py-3">
                      <input type="text" value={point.id} onChange={(e) => updatePoint(idx, 'id', e.target.value)} className="bg-transparent text-slate-900 font-bold focus:outline-none w-24 border-b-2 border-transparent focus:border-brand-500 transition-colors"/>
                    </td>
                    <td className="px-6 py-3">
                      <input type="number" value={point.x} onChange={(e) => updatePoint(idx, 'x', parseFloat(e.target.value))} className="bg-transparent focus:outline-none w-32 text-slate-600 border-b-2 border-transparent focus:border-brand-500 transition-colors"/>
                    </td>
                    <td className="px-6 py-3">
                      <input type="number" value={point.y} onChange={(e) => updatePoint(idx, 'y', parseFloat(e.target.value))} className="bg-transparent focus:outline-none w-32 text-slate-600 border-b-2 border-transparent focus:border-brand-500 transition-colors"/>
                    </td>
                    <td className="px-6 py-3">
                      <input type="number" value={point.z} onChange={(e) => updatePoint(idx, 'z', parseFloat(e.target.value))} className="bg-transparent focus:outline-none w-20 text-slate-600 border-b-2 border-transparent focus:border-brand-500 transition-colors"/>
                    </td>
                    <td className="px-6 py-3">
                      <input type="text" value={point.desc} onChange={(e) => updatePoint(idx, 'desc', e.target.value)} className="bg-transparent focus:outline-none w-full text-slate-500 italic border-b-2 border-transparent focus:border-brand-500 transition-colors"/>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button onClick={() => copyPoint(point)} title="Copiar Coordenadas" className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-md"><ClipboardCheck size={16} /></button>
                         <button onClick={() => flyToPoint(point)} title="Visualizar no Mapa" className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-md"><Eye size={16} /></button>
                         <div className="w-px h-4 bg-slate-200 mx-1"></div>
                         <button onClick={() => removePoint(idx)} title="Remover" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const Input = ({ label, value, onChange, placeholder, error }: any) => (
  <div>
    <label className="block text-[11px] uppercase font-bold text-slate-400 mb-1.5 tracking-wider flex justify-between">
        {label}
        {error && <span className="text-red-500 normal-case tracking-normal font-medium">{error}</span>}
    </label>
    <input 
      type="text" 
      value={value} 
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-slate-50 border rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:ring-2 focus:outline-none transition placeholder-slate-400 font-medium ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'}`}
    />
  </div>
);

// --- Elevation Chart Component ---
const ElevationProfile = ({ points }: { points: SurveyPoint[] }) => {
  const chartData = useMemo(() => {
    if (points.length < 2) return [];
    let cumulativeDist = 0;
    return points.map((p, i) => {
        if (i > 0) {
            const prev = points[i-1];
            cumulativeDist += Math.sqrt(Math.pow(p.x - prev.x, 2) + Math.pow(p.y - prev.y, 2));
        }
        return { name: p.id, distance: parseFloat(cumulativeDist.toFixed(2)), elevation: p.z, desc: p.desc };
    });
  }, [points]);

  return (
    <div className="h-full flex flex-col p-8 max-w-6xl mx-auto w-full">
         <div className="mb-6 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-1">Perfil Altimétrico</h2>
            <p className="text-sm text-slate-500">Análise de variação de cota (Z) vs. Distância acumulada.</p>
         </div>
         <div className="flex-1 bg-white rounded-xl border border-slate-200 p-6 shadow-sm relative">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                    <defs>
                        <linearGradient id="colorElev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="distance" stroke="#94a3b8" label={{ value: 'Distância Acumulada (m)', position: 'insideBottom', offset: -10, fill: '#64748b' }} tick={{fill: '#475569', fontSize: 12}} />
                    <YAxis dataKey="elevation" stroke="#94a3b8" label={{ value: 'Elevação (m)', angle: -90, position: 'insideLeft', fill: '#64748b' }} domain={['auto', 'auto']} tick={{fill: '#475569', fontSize: 12}} />
                    <RechartsTooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#1e293b', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} itemStyle={{ color: '#2563eb' }} labelStyle={{ color: '#64748b' }} />
                    <Area type="monotone" dataKey="elevation" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorElev)" activeDot={{ r: 6, strokeWidth: 0, fill: '#1d4ed8' }} />
                </AreaChart>
            </ResponsiveContainer>
            {chartData.length < 2 && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm rounded-xl">
                    <p className="text-slate-400 flex items-center gap-2"><AlertCircle size={20}/> Adicione mais pontos para visualizar o perfil.</p>
                </div>
            )}
         </div>
    </div>
  );
};

// --- 3D View Component ---

const CameraRig = ({ target, mode }: { target: SurveyPoint | null, mode: 'orbit' | 'top' | 'front' }) => {
    const { camera, controls } = useThree();
    const vec = new THREE.Vector3();

    useFrame(() => {
        if (mode === 'top') {
            camera.position.lerp(vec.set(0, 100, 0), 0.05);
            (controls as any)?.target?.lerp(vec.set(0,0,0), 0.05);
        } else if (mode === 'front') {
            camera.position.lerp(vec.set(0, 0, 100), 0.05);
            (controls as any)?.target?.lerp(vec.set(0,0,0), 0.05);
        } else if (target) {
            // "Fly to" logic (simplified relative to center since points are normalized in parent)
            // We assume the parent View3D normalizes data so 0,0,0 is center
            // But here target is raw. We need to normalize or rely on parent passing normalized pos.
            // For simplicity, we just look at center if target is null, or look at target if set
            // Note: In real app, coordinate conversion needed. Here we act as if mode switch triggers movement.
        }
        if (controls) (controls as any).update();
    });

    useEffect(() => {
        if (target && controls) {
             // Basic fly to effect by moving controls target
             // NOTE: This assumes points in View3D are centered around 0,0,0 based on average.
             // We'd need to calculate the relative position of 'target' vs 'average'.
             // For this demo, we'll just reset camera to a nice angle.
             camera.position.set(20, 20, 20);
             (controls as any).target.set(0, 0, 0);
        }
    }, [target]);

    return null;
}

const View3D = ({ points }: { points: SurveyPoint[] }) => {
  const [targetPoint, setTargetPoint] = useState<SurveyPoint | null>(null);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'top' | 'front'>('orbit');

  const normalizedData = useMemo(() => {
    if (points.length === 0) return { center: [0,0,0], points: [] };
    const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
    const avgZ = points.reduce((s, p) => s + p.z, 0) / points.length;
    const normPoints = points.map(p => ({ ...p, pos: [p.x - avgX, p.z - avgZ, -(p.y - avgY)] as [number, number, number] }));
    return { center: [avgX, avgY, avgZ], points: normPoints };
  }, [points]);

  const linePoints = useMemo(() => {
    if (normalizedData.points.length === 0) return [];
    const pts = normalizedData.points.map(p => new THREE.Vector3(...p.pos));
    pts.push(pts[0]);
    return pts;
  }, [normalizedData]);

  const terrainGeometry = useMemo(() => {
    if (normalizedData.points.length < 3) return null;
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const center = [0,0,0];
    for(let i=0; i<normalizedData.points.length; i++) {
        const p1 = normalizedData.points[i].pos;
        const p2 = normalizedData.points[(i+1) % normalizedData.points.length].pos;
        vertices.push(...center, ...p1, ...p2);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [normalizedData]);

  return (
    <div className="w-full h-full relative bg-slate-900">
      <Canvas camera={{ position: [50, 50, 50], fov: 45 }}>
        <color attach="background" args={['#0f172a']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 20, 5]} intensity={1.5} />
        <OrbitControls makeDefault dampingFactor={0.1} />
        <gridHelper args={[500, 50, '#334155', '#1e293b']} />
        <CameraRig target={targetPoint} mode={cameraMode} />
        {terrainGeometry && (
            <mesh geometry={terrainGeometry} position={[0, -0.05, 0]}>
                <meshStandardMaterial color="#1e293b" side={THREE.DoubleSide} opacity={0.8} transparent />
            </mesh>
        )}
        {normalizedData.points.map((p, i) => (
          <group key={i} position={p.pos}>
            <mesh position={[0, -2.5, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 5]} />
              <meshStandardMaterial color="#cbd5e1" />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.4]} />
              <meshStandardMaterial color="#ef4444" />
            </mesh>
            <Html position={[0, 1.5, 0]} center>
              <div className="bg-white/90 backdrop-blur px-2 py-1 rounded-md text-[10px] text-slate-900 border border-slate-200 shadow-lg font-bold whitespace-nowrap">
                {p.id}
              </div>
            </Html>
          </group>
        ))}
        {linePoints.length > 0 && <Line points={linePoints} color="#3b82f6" lineWidth={3} />}
        <GizmoHelper alignment="bottom-right" margin={[80, 80]} onUpdate={() => {}}>
            <GizmoViewport axisColors={['#ef4444', '#10b981', '#3b82f6']} labelColor="white" />
        </GizmoHelper>
      </Canvas>

      {/* Advanced Camera Controls UI */}
      <div className="absolute top-4 right-4 bg-white/10 backdrop-blur-md border border-white/20 p-2 rounded-lg flex flex-col gap-2 z-10">
         <div className="flex gap-1">
             <button onClick={() => setCameraMode('top')} className={`p-2 rounded hover:bg-white/20 text-white ${cameraMode === 'top' ? 'bg-white/20' : ''}`} title="Vista Superior">
                 <GridIcon size={18}/>
             </button>
             <button onClick={() => setCameraMode('front')} className={`p-2 rounded hover:bg-white/20 text-white ${cameraMode === 'front' ? 'bg-white/20' : ''}`} title="Vista Frontal">
                 <Video size={18}/>
             </button>
             <button onClick={() => setCameraMode('orbit')} className={`p-2 rounded hover:bg-white/20 text-white ${cameraMode === 'orbit' ? 'bg-white/20' : ''}`} title="Orbita Livre">
                 <RotateCcw size={18}/>
             </button>
         </div>
         <div className="h-px bg-white/10 my-1"></div>
         <div className="relative">
             <select 
                onChange={(e) => {
                    const pt = points.find(p => p.id === e.target.value);
                    if (pt) {
                        setTargetPoint(pt); 
                        setCameraMode('orbit');
                    }
                }} 
                className="w-full bg-slate-800 text-white text-xs p-2 rounded border border-slate-700 outline-none cursor-pointer"
             >
                 <option value="">Voar para ponto...</option>
                 {points.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
             </select>
         </div>
      </div>

      <div className="absolute bottom-4 left-4 bg-white/90 p-4 rounded-lg border border-slate-200 shadow-xl text-xs text-slate-600 pointer-events-none z-10">
        <p className="font-bold text-slate-900 mb-2 text-sm">Controles 3D</p>
        <div className="space-y-1">
          <p>Botão Esquerdo: <span className="font-semibold">Rotacionar</span></p>
          <p>Botão Direito: <span className="font-semibold">Pan</span></p>
          <p>Scroll: <span className="font-semibold">Zoom</span></p>
        </div>
      </div>
    </div>
  );
};

// --- Map Component ---

interface SurveyMapProps {
  points: SurveyPoint[];
  setPoints: (points: SurveyPoint[]) => void;
  annotations: MapAnnotation[];
  setAnnotations: (annos: MapAnnotation[]) => void;
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
}

const SurveyMap = ({ 
  points, setPoints, annotations, setAnnotations,
  viewBox, setViewBox, mapStyle, setMapStyle, 
  selectedIds, setSelectedIds, undo, redo, canUndo, canRedo, 
  openConfig, layerConfig
}: SurveyMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'pan' | 'point' | 'polyline' | 'move' | 'delete' | 'measure' | 'area' | 'text'>('select');
  const [cursorCoords, setCursorCoords] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(true);

  // Interaction State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoverPoint, setHoverPoint] = useState<SurveyPoint | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);
  
  // Measure State
  const [measureStart, setMeasureStart] = useState<{x: number, y: number} | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{x: number, y: number} | null>(null);

  // Area State
  const [areaPoints, setAreaPoints] = useState<{x: number, y: number}[]>([]);
  
  // Move State
  const [movingPointIndex, setMovingPointIndex] = useState<number | null>(null);
  const [movingAnnotationIndex, setMovingAnnotationIndex] = useState<number | null>(null);

  const bounds = useMemo(() => {
    if (points.length === 0) return { minX:0, maxX:100, minY:0, maxY:100, w:100, h:100 };
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX || 10;
    const h = maxY - minY || 10;
    return { minX: minX - w * 0.1, maxX: maxX + w * 0.1, minY: minY - h * 0.1, maxY: maxY + h * 0.1, w: w * 1.2, h: h * 1.2 };
  }, [points]);

  const transform = useMemo(() => {
     const scaleX = 1000 / bounds.w;
     const scaleY = 1000 / bounds.h;
     const scale = Math.min(scaleX, scaleY);
     const drawnW = bounds.w * scale;
     const drawnH = bounds.h * scale;
     const offsetX = (1000 - drawnW) / 2;
     const offsetY = (1000 - drawnH) / 2;
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

  const pointsStr = useMemo(() => points.map(p => {
       const { svgX, svgY } = toSvg(p.x, p.y);
       return `${svgX},${svgY}`;
    }).join(' '), [points, transform]);

  const areaPointsStr = useMemo(() => areaPoints.map(p => {
      const { svgX, svgY } = toSvg(p.x, p.y);
      return `${svgX},${svgY}`;
  }).join(' '), [areaPoints, transform]);

  const selectionPolygonStr = useMemo(() => {
      if (selectedIds.size < 3) return '';
      const selectedPoints = points.filter(p => selectedIds.has(p.id));
      // Basic convex hull or just connection in order? 
      // For survey, users usually select sequentially or expect sequential connection.
      // We will just connect them in order of the array.
      return selectedPoints.map(p => {
          const { svgX, svgY } = toSvg(p.x, p.y);
          return `${svgX},${svgY}`;
      }).join(' ');
  }, [points, selectedIds, transform]);

  const selectionStats = useMemo(() => {
     if (selectedIds.size < 2) return null;
     const selectedPoints = points.filter(p => selectedIds.has(p.id));
     return {
         area: calculateArea(selectedPoints),
         perimeter: calculatePerimeter(selectedPoints)
     };
  }, [points, selectedIds]);

  useEffect(() => {
    if (viewBox.x === 0 && viewBox.y === 0 && viewBox.w === 1000 && viewBox.h === 1000) {
        setViewBox({ x: 0, y: 0, w: 1000, h: 1000 });
    }
  }, [points.length]); 

  // --- Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    const dataPos = fromSvg(svgClickX, svgClickY);

    if (activeTool === 'pan') {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
    }

    if (activeTool === 'move') {
        // Find nearest point
        const snapDist = 20 * zoomFactor / transform.scale;
        const nearestIdx = points.findIndex(p => Math.sqrt(Math.pow(p.x - dataPos.x, 2) + Math.pow(p.y - dataPos.y, 2)) < snapDist);
        if (nearestIdx !== -1) {
            setMovingPointIndex(nearestIdx);
            setIsDragging(true);
            return;
        }
        // Move annotation?
        const nearestAnnoIdx = annotations.findIndex(a => Math.sqrt(Math.pow(a.x - dataPos.x, 2) + Math.pow(a.y - dataPos.y, 2)) < snapDist);
        if (nearestAnnoIdx !== -1) {
            setMovingAnnotationIndex(nearestAnnoIdx);
            setIsDragging(true);
            return;
        }
        return;
    }

    if (activeTool === 'select') {
        // If clicking on a point, toggle selection.
        const snapDist = 20 * zoomFactor / transform.scale;
        const nearest = points.find(p => Math.sqrt(Math.pow(p.x - dataPos.x, 2) + Math.pow(p.y - dataPos.y, 2)) < snapDist);
        
        if (nearest) {
            const newSet = new Set(e.shiftKey ? selectedIds : []);
            if (e.shiftKey && selectedIds.has(nearest.id)) newSet.delete(nearest.id);
            else newSet.add(nearest.id);
            setSelectedIds(newSet);
        } else {
            // Start selection rect
            // Not fully implemented for rect drag logic in this snippet, defaulting to Pan behavior for empty space if not dragging rect
            setIsDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    const dataPos = fromSvg(svgClickX, svgClickY);
    
    // Update Coordinate Display
    setCursorCoords({ x: dataPos.x, y: dataPos.y });

    if (activeTool === 'pan' && isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setViewBox({ ...viewBox, x: viewBox.x - dx * zoomFactor, y: viewBox.y - dy * zoomFactor });
      setDragStart({ x: e.clientX, y: e.clientY });
    }

    if (activeTool === 'move' && isDragging) {
        if (movingPointIndex !== null) {
            const newPoints = [...points];
            newPoints[movingPointIndex] = { ...newPoints[movingPointIndex], x: dataPos.x, y: dataPos.y };
            setPoints(newPoints);
        } else if (movingAnnotationIndex !== null) {
            const newAnnos = [...annotations];
            newAnnos[movingAnnotationIndex] = { ...newAnnos[movingAnnotationIndex], x: dataPos.x, y: dataPos.y };
            setAnnotations(newAnnos);
        }
    }

    // Snapping Logic Helper
    let target = dataPos;
    if (snapEnabled) {
      const snapDist = 20 * zoomFactor / transform.scale;
      const nearest = points.find(p => Math.sqrt(Math.pow(p.x - dataPos.x, 2) + Math.pow(p.y - dataPos.y, 2)) < snapDist);
      if (nearest) target = { x: nearest.x, y: nearest.y };
    }

    if (activeTool === 'measure') {
       if (measureStart) {
           setMeasureEnd(target);
       }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setMovingPointIndex(null);
    setMovingAnnotationIndex(null);
  };

  const handleMapClick = (e: React.MouseEvent) => {
    if (activeTool === 'pan' || isDragging) return;

    const rect = containerRef.current!.getBoundingClientRect();
    const zoomFactor = viewBox.w / rect.width;
    const svgClickX = viewBox.x + (e.clientX - rect.left) * zoomFactor;
    const svgClickY = viewBox.y + (e.clientY - rect.top) * zoomFactor;
    let dataPos = fromSvg(svgClickX, svgClickY);

    // Snapping Logic (Applied to Point, Measure, Area, etc.)
    if (snapEnabled) {
         const snapDist = 20 * zoomFactor / transform.scale;
         const nearest = points.find(p => Math.sqrt(Math.pow(p.x - dataPos.x, 2) + Math.pow(p.y - dataPos.y, 2)) < snapDist);
         if (nearest) dataPos = { x: nearest.x, y: nearest.y };
    }

    if (activeTool === 'point' || activeTool === 'polyline') {
        const newId = `P${(points.length + 1).toString().padStart(2, '0')}`;
        setPoints([...points, { id: newId, x: dataPos.x, y: dataPos.y, z: 0, desc: 'Novo Ponto' }]);
    }

    if (activeTool === 'area') {
        setAreaPoints([...areaPoints, dataPos]);
    }

    if (activeTool === 'text') {
        const text = prompt("Digite o texto da anotação:");
        if (text) {
            setAnnotations([...annotations, { 
                id: `T${annotations.length + 1}`, 
                x: dataPos.x, 
                y: dataPos.y, 
                text, 
                size: 12, 
                color: '#000' 
            }]);
            setActiveTool('select');
        }
    }

    if (activeTool === 'delete') {
         const snapDist = 20 * zoomFactor / transform.scale;
         const nearestIdx = points.findIndex(p => Math.sqrt(Math.pow(p.x - dataPos.x, 2) + Math.pow(p.y - dataPos.y, 2)) < snapDist);
         if (nearestIdx !== -1) {
             const newPoints = points.filter((_, i) => i !== nearestIdx);
             setPoints(newPoints);
             return;
         }
         const nearestAnnoIdx = annotations.findIndex(a => Math.sqrt(Math.pow(a.x - dataPos.x, 2) + Math.pow(a.y - dataPos.y, 2)) < snapDist);
         if (nearestAnnoIdx !== -1) {
             const newAnnos = annotations.filter((_, i) => i !== nearestAnnoIdx);
             setAnnotations(newAnnos);
         }
    }

    if (activeTool === 'measure') {
        if (!measureStart) {
            setMeasureStart(dataPos);
            setMeasureEnd(dataPos);
        } else {
            setMeasureEnd(dataPos);
            setActiveTool('select'); // Finish measurement
        }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomIntensity = 0.1;
    const direction = e.deltaY > 0 ? 1 : -1;
    const wChange = viewBox.w * zoomIntensity * direction;
    const hChange = viewBox.h * zoomIntensity * direction;
    setViewBox({ x: viewBox.x - wChange / 2, y: viewBox.y - hChange / 2, w: viewBox.w + wChange, h: viewBox.h + hChange });
  };

  const zoomExtents = () => {
     setViewBox({ x: 0, y: 0, w: 1000, h: 1000 });
  };

  const finishArea = () => {
     setActiveTool('select');
  };

  // Clear area points when entering area tool
  useEffect(() => {
      if (activeTool === 'area') {
          setAreaPoints([]);
      }
  }, [activeTool]);

  // --- Rendering Helpers ---

  const distance = useMemo(() => {
    if (measureStart && measureEnd) {
      const dx = measureEnd.x - measureStart.x;
      const dy = measureEnd.y - measureStart.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    return 0;
  }, [measureStart, measureEnd]);

  const currentArea = useMemo(() => calculateArea(areaPoints), [areaPoints]);

  const measureLineSvg = useMemo(() => {
    if (!measureStart || !measureEnd) return null;
    return { start: toSvg(measureStart.x, measureStart.y), end: toSvg(measureEnd.x, measureEnd.y) };
  }, [measureStart, measureEnd, transform]);

  const gridLines = useMemo(() => {
    if (!gridEnabled) return [];
    const topLeft = fromSvg(viewBox.x, viewBox.y);
    const bottomRight = fromSvg(viewBox.x + viewBox.w, viewBox.y + viewBox.h);
    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, bottomRight.y);
    const dataWidth = maxX - minX;
    let step = Math.pow(10, Math.floor(Math.log10(dataWidth / 5)));
    if (dataWidth / step < 3) step /= 2;
    if (dataWidth / step > 10) step *= 2;
    const startX = Math.ceil(minX / step) * step;
    const startY = Math.ceil(minY / step) * step;
    const lines = [];
    for (let x = startX; x <= maxX; x += step) {
        const p1 = toSvg(x, minY);
        lines.push({ x1: p1.svgX, y1: 0, x2: p1.svgX, y2: 10000, label: x.toLocaleString('pt-BR'), type: 'v', svgPos: p1.svgX });
    }
    for (let y = startY; y <= maxY; y += step) {
        const p1 = toSvg(minX, y);
        lines.push({ x1: -10000, y1: p1.svgY, x2: 10000, y2: p1.svgY, label: y.toLocaleString('pt-BR'), type: 'h', svgPos: p1.svgY });
    }
    return lines;
  }, [viewBox, transform, gridEnabled]);

  const cursorClass = () => {
      switch(activeTool) {
          case 'pan': return isDragging ? 'cursor-grabbing' : 'cursor-grab';
          case 'point': return 'cursor-crosshair';
          case 'polyline': return 'cursor-crosshair';
          case 'measure': return 'cursor-crosshair';
          case 'area': return 'cursor-crosshair';
          case 'move': return 'cursor-move';
          case 'text': return 'cursor-text';
          case 'delete': return 'cursor-not-allowed';
          default: return 'cursor-default';
      }
  };

  return (
    <div className={`w-full h-full relative overflow-hidden select-none flex flex-col ${mapStyle === 'tech' ? 'bg-white' : mapStyle === 'satellite' ? 'satellite-bg' : 'bg-slate-50'}`}>
      
      {/* Top Standard Toolbar */}
      <div className="h-10 bg-slate-100 border-b border-slate-300 flex items-center px-2 shadow-sm z-20 gap-1">
          <ToolbarBtn icon={<GridIcon size={16}/>} active={gridEnabled} onClick={() => setGridEnabled(!gridEnabled)} title="Grade (F7)" />
          <ToolbarBtn icon={<Magnet size={16}/>} active={snapEnabled} onClick={() => setSnapEnabled(!snapEnabled)} title="Snap (F3)" />
          <div className="w-px h-6 bg-slate-300 mx-1"></div>
          <ToolbarBtn icon={<Undo size={16}/>} onClick={undo} disabled={!canUndo} title="Desfazer" />
          <ToolbarBtn icon={<Redo size={16}/>} onClick={redo} disabled={!canRedo} title="Refazer" />
          <div className="w-px h-6 bg-slate-300 mx-1"></div>
          <ToolbarBtn icon={<Maximize size={16}/>} onClick={zoomExtents} title="Zoom Extents" />
          <ToolbarBtn icon={<ZoomIn size={16}/>} onClick={() => {const f=0.8; setViewBox({...viewBox, x: viewBox.x+viewBox.w*(1-f)/2, y: viewBox.y+viewBox.h*(1-f)/2, w: viewBox.w*f, h: viewBox.h*f})}} title="Zoom In" />
          <ToolbarBtn icon={<ZoomOut size={16}/>} onClick={() => {const f=1.2; setViewBox({...viewBox, x: viewBox.x+viewBox.w*(1-f)/2, y: viewBox.y+viewBox.h*(1-f)/2, w: viewBox.w*f, h: viewBox.h*f})}} title="Zoom Out" />
          <div className="w-px h-6 bg-slate-300 mx-1"></div>
          <div className="flex bg-white border border-slate-300 rounded overflow-hidden">
             <button onClick={() => setMapStyle('tech')} className={`px-2 py-1 text-xs font-medium ${mapStyle === 'tech' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>Tech</button>
             <button onClick={() => setMapStyle('satellite')} className={`px-2 py-1 text-xs font-medium ${mapStyle === 'satellite' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>Satélite</button>
          </div>
      </div>

      <div className="flex-1 relative flex overflow-hidden">
         {/* Left Draw Toolbar */}
         <div className="w-10 bg-slate-100 border-r border-slate-300 flex flex-col items-center py-2 gap-2 z-20 shadow-sm">
             <ToolbarBtn icon={<MousePointer2 size={18}/>} active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="Selecionar" />
             <div className="w-6 h-px bg-slate-300"></div>
             <ToolbarBtn icon={<Circle size={18}/>} active={activeTool === 'point'} onClick={() => setActiveTool('point')} title="Desenhar Ponto" />
             <ToolbarBtn icon={<TypeIcon size={18}/>} active={activeTool === 'polyline'} onClick={() => setActiveTool('polyline')} title="Polilinha (Adicionar Pontos)" />
             <ToolbarBtn icon={<Pentagon size={18}/>} active={activeTool === 'area'} onClick={() => setActiveTool('area')} title="Calcular Área" />
             <ToolbarBtn icon={<TypeIcon size={18}/>} active={activeTool === 'text'} onClick={() => setActiveTool('text')} title="Texto / Anotação" />
             <div className="w-6 h-px bg-slate-300"></div>
             <ToolbarBtn icon={<Ruler size={18}/>} active={activeTool === 'measure'} onClick={() => { setActiveTool('measure'); setMeasureStart(null); setMeasureEnd(null); }} title="Medir Distância" />
             <ToolbarBtn icon={<Hand size={18}/>} active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} title="Pan (Mão)" />
         </div>

         {/* Canvas Area */}
         <div className="flex-1 relative bg-white overflow-hidden">
            {/* Grid Background */}
            <div className={`absolute inset-0 ${gridEnabled && mapStyle === 'tech' ? 'grid-bg-light' : ''} pointer-events-none`}></div>

            <div 
                ref={containerRef}
                className={`w-full h-full ${cursorClass()}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleMapClick}
                onWheel={handleWheel}
            >
                <svg viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                {/* Grid Lines */}
                {gridLines.map((line, i) => (
                    <g key={`grid-${i}`}>
                        <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={mapStyle === 'satellite' ? '#ffffff30' : '#e2e8f0'} strokeWidth={1 * (viewBox.w / 1000)} vectorEffect="non-scaling-stroke"/>
                    </g>
                ))}
                
                {/* Area Tool Polygon */}
                {areaPoints.length > 0 && (
                    <g>
                        <polygon points={areaPointsStr} fill="rgba(16, 185, 129, 0.2)" stroke="#10b981" strokeWidth={2 * (viewBox.w / 1000)} vectorEffect="non-scaling-stroke" />
                        {areaPoints.map((p, i) => {
                             const { svgX, svgY } = toSvg(p.x, p.y);
                             return <circle key={i} cx={svgX} cy={svgY} r={3 * (viewBox.w / 1000)} fill="#10b981" />;
                        })}
                    </g>
                )}

                {/* Selection Highlight Polygon */}
                {selectionPolygonStr && (
                   <polygon points={selectionPolygonStr} fill={layerConfig.selectedColor + '33'} stroke={layerConfig.selectedColor} strokeWidth={layerConfig.lineWidth * (viewBox.w / 1000)} strokeDasharray="5,5" vectorEffect="non-scaling-stroke"/>
                )}

                {/* Main Lines */}
                <polyline points={pointsStr + (points.length > 0 ? ` ${pointsStr.split(' ')[0]}` : '')} fill={mapStyle === 'satellite' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.1)'} stroke={layerConfig.lineColor} strokeWidth={layerConfig.lineWidth * (viewBox.w / 1000)} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
                
                {/* Points */}
                {points.map((p, i) => {
                    const { svgX, svgY } = toSvg(p.x, p.y);
                    const r = layerConfig.pointSize * (viewBox.w / 1000); 
                    const isHovered = hoverPoint?.id === p.id;
                    const isMoving = movingPointIndex === i;
                    const isSelected = selectedIds.has(p.id);

                    return (
                    <g key={i} onMouseEnter={() => setHoverPoint(p)} onMouseLeave={() => setHoverPoint(null)} className="group">
                        <circle cx={svgX} cy={svgY} r={isSelected ? r * 1.5 : r} 
                            fill={isSelected ? layerConfig.selectedColor : isMoving ? '#fbbf24' : layerConfig.pointColor}
                            className="transition-colors"
                        />
                        {layerConfig.showLabels && (
                          <text x={svgX + r * 2} y={svgY} fontSize={12 * (viewBox.w / 1000)} className={`font-mono font-bold pointer-events-none ${mapStyle === 'satellite' ? 'fill-white' : 'fill-slate-700'}`} dy=".3em">{p.id}</text>
                        )}
                    </g>
                    );
                })}

                {/* Annotations */}
                {annotations.map((a, i) => {
                    const { svgX, svgY } = toSvg(a.x, a.y);
                    return (
                        <text key={a.id} x={svgX} y={svgY} fontSize={14 * (viewBox.w / 1000)} fill="black" textAnchor="middle" style={{ userSelect: 'none' }}>{a.text}</text>
                    );
                })}

                {/* Measure Line */}
                {measureLineSvg && measureLineSvg.end && (
                    <g pointerEvents="none">
                    <line x1={measureLineSvg.start.svgX} y1={measureLineSvg.start.svgY} x2={measureLineSvg.end.svgX} y2={measureLineSvg.end.svgY} stroke="#dc2626" strokeWidth={2 * (viewBox.w / 1000)} strokeDasharray="8,4"/>
                    <text x={(measureLineSvg.start.svgX + measureLineSvg.end.svgX) / 2} y={(measureLineSvg.start.svgY + measureLineSvg.end.svgY) / 2} fontSize={14 * (viewBox.w / 1000)} fill="#dc2626" textAnchor="middle" fontWeight="bold" dy="-1em" style={{textShadow: '0px 2px 4px white'}}>{distance.toFixed(3)} m</text>
                    </g>
                )}
                </svg>
            </div>
         </div>

         {/* Right Modify Toolbar */}
         <div className="w-10 bg-slate-100 border-l border-slate-300 flex flex-col items-center py-2 gap-2 z-20 shadow-sm">
             <ToolbarBtn icon={<Move size={18}/>} active={activeTool === 'move'} onClick={() => setActiveTool('move')} title="Mover Elemento" />
             <ToolbarBtn icon={<Trash size={18}/>} active={activeTool === 'delete'} onClick={() => setActiveTool('delete')} title="Apagar (Delete)" />
             <div className="w-6 h-px bg-slate-300"></div>
             <ToolbarBtn icon={<Settings size={18}/>} onClick={openConfig} title="Configurações Visuais" />
         </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-8 bg-slate-100 border-t border-slate-300 flex items-center justify-between px-3 text-xs font-mono text-slate-600 select-none z-20">
         <div className="flex items-center gap-4">
            <span className="w-32 truncate" title="Coordenadas do Cursor">
               {cursorCoords.x.toFixed(3)}, {cursorCoords.y.toFixed(3)}
            </span>
            <div className="w-px h-4 bg-slate-300"></div>
            <button className={`font-bold hover:bg-slate-200 px-1 rounded ${snapEnabled ? 'text-slate-900' : 'text-slate-400'}`} onClick={() => setSnapEnabled(!snapEnabled)}>SNAP</button>
            <button className={`font-bold hover:bg-slate-200 px-1 rounded ${gridEnabled ? 'text-slate-900' : 'text-slate-400'}`} onClick={() => setGridEnabled(!gridEnabled)}>GRID</button>
         </div>
         <div className="flex items-center gap-2">
            <span>Escala 1:{(1000 / viewBox.w * 100).toFixed(0)}</span>
            <div className="w-px h-4 bg-slate-300"></div>
            <span>{activeTool.toUpperCase()}</span>
         </div>
      </div>

      {/* Floating Info Box for Active Tool Instructions */}
      <div className="absolute top-12 left-14 z-20 pointer-events-none">
          {activeTool !== 'select' && (
             <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-1.5 rounded shadow-sm text-xs font-medium flex items-center gap-2 animate-in fade-in">
                {activeTool === 'point' && <span>Clique no mapa para criar pontos (Snap Ativo)</span>}
                {activeTool === 'polyline' && <span>Adicione pontos sequenciais</span>}
                {activeTool === 'measure' && <span>Clique para medir (Início -&gt; Fim)</span>}
                {activeTool === 'area' && <span>Clique em vários pontos para definir área</span>}
                {activeTool === 'text' && <span>Clique para adicionar texto</span>}
                {activeTool === 'move' && <span>Arraste pontos/textos para mover</span>}
                {activeTool === 'delete' && <span>Clique em um elemento para apagar</span>}
                {activeTool === 'pan' && <span>Arraste para mover o mapa</span>}
             </div>
          )}
      </div>
      
      {/* Area Result Overlay */}
      {activeTool === 'area' && areaPoints.length > 2 && (
          <div className="absolute top-24 left-14 z-20 bg-emerald-50 border border-emerald-200 p-3 rounded shadow-lg animate-in fade-in slide-in-from-left-2">
              <div className="text-xs text-emerald-800 font-bold mb-1">Área Calculada</div>
              <div className="text-lg font-mono text-emerald-700">{(currentArea).toFixed(2)} m²</div>
              <div className="text-xs text-emerald-600 font-mono">{(currentArea / 10000).toFixed(4)} ha</div>
              <button onClick={finishArea} className="mt-2 w-full bg-emerald-600 text-white text-xs font-bold py-1 rounded hover:bg-emerald-700 pointer-events-auto">
                  Finalizar
              </button>
          </div>
      )}

      {/* Selection Stats Overlay */}
      {selectionStats && activeTool === 'select' && (
          <div className="absolute top-12 right-14 z-20 bg-white/90 backdrop-blur border border-slate-200 p-4 rounded-lg shadow-lg animate-in fade-in slide-in-from-right-2 max-w-xs">
              <div className="text-sm font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">Seleção ({selectedIds.size} pts)</div>
              <div className="space-y-2">
                 <div>
                    <span className="text-xs text-slate-500 uppercase font-bold">Área</span>
                    <div className="text-sm font-mono text-slate-700">{(selectionStats.area / 10000).toFixed(4)} ha</div>
                    <div className="text-xs font-mono text-slate-400">{(selectionStats.area).toFixed(2)} m²</div>
                 </div>
                 <div>
                    <span className="text-xs text-slate-500 uppercase font-bold">Perímetro</span>
                    <div className="text-sm font-mono text-slate-700">{selectionStats.perimeter.toFixed(2)} m</div>
                 </div>
              </div>
          </div>
      )}

    </div>
  );
};

const ToolbarBtn = ({ icon, active, onClick, title, disabled }: any) => (
    <button 
      onClick={onClick} 
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-sm transition-all