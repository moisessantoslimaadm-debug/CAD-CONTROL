import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { 
  Hexagon, 
  Map as MapIcon, 
  Table2, 
  Calculator, 
  FileDown, 
  Settings, 
  Plus, 
  Trash2, 
  Upload, 
  Search, 
  Layers,
  Ruler,
  Eye,
  EyeOff,
  Copy,
  LocateFixed,
  Download,
  Save,
  Crosshair,
  Box,
  Palette,
  Check,
  X,
  TrendingUp,
  FileText,
  Globe,
  Mountain,
  Component,
  Maximize,
  Edit2,
  RefreshCw,
  MoreVertical,
  HelpCircle,
  Scissors,
  Magnet,
  MousePointer2,
  Grid,
  Circle,
  Square,
  Calendar,
  AlertCircle,
  Triangle,
  Move,
  History,
  FileOutput,
  PenTool,
  Network,
  Waypoints,
  Move3d,
  MousePointerClick
} from 'lucide-react';
import './index.css';

// --- Types ---
interface Point {
  id: string;
  name: string;
  n: number; // North (Y)
  e: number; // East (X)
  z: number; // Elevation
  desc: string;
  date: string; // ISO Date string YYYY-MM-DD
}

interface SavedView {
  id: string;
  name: string;
  zoom: number;
  pan: { x: number, y: number };
}

interface ProjectVersion {
    id: string;
    name: string;
    date: string;
    points: Point[];
}

interface LayerConfig {
  color: string;
  visible: boolean;
}

interface VisualSettings {
  pointSize: number;
  selectedColor: string;
  hoverColor: string;
  snapColor: string;
}

interface CsvMapping {
  id: number;
  name: number;
  n: number;
  e: number;
  z: number;
  desc: number;
  separator: string;
  hasHeader: boolean;
}

interface SnapSettings {
  enabled: boolean;
  vertices: boolean;
  midpoints: boolean;
  grid: boolean;
  gridInterval: number;
  distance: number;
}

// Edge structure for TIN
interface Edge {
    p1: Point;
    p2: Point;
}

type ToolType = 'geodesia' | 'memorial' | 'reconstituicao' | 'modelagem' | 'curvas' | 'perfil' | 'secoes' | 'georref' | 'incra' | 'volume' | 'greide' | 'declividade' | 'plato' | null;

// --- Mock Data ---
const INITIAL_POINTS: Point[] = [
  { id: '1', name: 'M-01', n: 7500123.456, e: 350123.456, z: 102.54, desc: 'Marco', date: '2023-10-01' },
  { id: '2', name: 'C-01', n: 7500145.120, e: 350140.220, z: 105.10, desc: 'Cerca', date: '2023-10-02' },
  { id: '3', name: 'C-02', n: 7500130.880, e: 350180.550, z: 108.80, desc: 'Cerca', date: '2023-10-02' },
  { id: '4', name: 'P-01', n: 7500100.200, e: 350160.100, z: 106.00, desc: 'Poste', date: '2023-10-05' },
  { id: '5', name: 'B-01', n: 7500090.500, e: 350130.800, z: 103.50, desc: 'Bordo', date: '2023-10-05' },
  { id: '6', name: 'B-02', n: 7500080.120, e: 350110.400, z: 101.20, desc: 'Bordo', date: '2023-10-06' },
  { id: '7', name: 'E-01', n: 7500110.330, e: 350090.900, z: 100.10, desc: 'Eixo', date: '2023-10-07' },
  { id: '8', name: 'M-02', n: 7500155.000, e: 350110.000, z: 104.20, desc: 'Marco', date: '2023-10-08' },
  // Adding more points for better contour viz
  { id: '9', name: 'G-01', n: 7500135.000, e: 350150.000, z: 107.50, desc: 'Natural', date: '2023-10-09' },
  { id: '10', name: 'G-02', n: 7500115.000, e: 350105.000, z: 101.80, desc: 'Natural', date: '2023-10-09' },
];

// --- Utilities ---
const normalize = (val: number, min: number, range: number, size: number, padding: number) => {
  return ((val - min) / range) * (size - padding * 2) + padding;
};

const denormalize = (val: number, min: number, range: number, size: number, padding: number) => {
    return ((val - padding) / (size - padding * 2)) * range + min;
};

// Vector math for projection
const projectPointOnSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const atob = { x: bx - ax, y: by - ay };
    const atop = { x: px - ax, y: py - ay };
    const len = atob.x * atob.x + atob.y * atob.y;
    let dot = atop.x * atob.x + atop.y * atob.y;
    const t = Math.min(1, Math.max(0, dot / len));
    return {
        x: ax + atob.x * t,
        y: ay + atob.y * t,
        t: t // fraction along the segment
    };
};

const fakeGeoConvert = (n: number, e: number) => {
     // Simplified conversion for KML demo
     const lat = -23.5 - (n - 7000000) / 100000;
     const long = -46.6 - (e - 300000) / 100000;
     return { lat, long };
}

const isValidCoordinate = (val: any) => {
    const num = parseFloat(val);
    return !isNaN(num) && isFinite(num);
};

// Ranges for UTM Zone 22/23S approx for validation example
const isValidNorth = (n: number) => n > 6000000 && n < 10000000; 
const isValidEast = (e: number) => e > 100000 && e < 900000;

// Helper to convert hex to KML color (AABBGGRR)
const hexToKmlColor = (hex: string, alpha: string = 'ff') => {
    const r = hex.substring(1, 3);
    const g = hex.substring(3, 5);
    const b = hex.substring(5, 7);
    return `${alpha}${b}${g}${r}`;
};

// Calculations
const calculateAzimuth = (p1: {n:number, e:number}, p2: {n:number, e:number}) => {
    const dy = p2.n - p1.n;
    const dx = p2.e - p1.e;
    let rad = Math.atan2(dx, dy); // Azimuth is from North (Y axis), so (dx, dy)
    let deg = rad * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return deg;
};

const calculateDistance3D = (p1: Point, p2: Point) => {
    const dH = Math.sqrt(Math.pow(p2.e - p1.e, 2) + Math.pow(p2.n - p1.n, 2));
    const dZ = p2.z - p1.z;
    const dS = Math.sqrt(Math.pow(dH, 2) + Math.pow(dZ, 2));
    return { horizontal: dH, slope: dS, deltaZ: dZ, grade: (dZ/dH)*100 };
};

// --- Sub-Components ---

const ModalWindow = ({ title, icon: Icon, onClose, children }: { title: string, icon: any, onClose: () => void, children?: React.ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
    <div className="bg-[#18181b] w-full max-w-2xl max-h-[90vh] rounded-xl border border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#27272a]">
        <div className="flex items-center gap-2 text-white font-bold">
          <Icon className="text-cad-accent" size={20} />
          {title}
        </div>
        <button onClick={onClose} className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 text-zinc-300">
        {children}
      </div>
    </div>
  </div>
);

const AutoCADTooltip = ({ title, desc, children }: { title: string, desc: string, children?: React.ReactNode }) => {
    return (
        <div className="relative group/tooltip">
            {children}
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-48 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-200 pointer-events-none z-[60]">
                <div className="bg-[#27272a] border border-white/10 p-3 rounded shadow-xl">
                    <div className="text-white text-xs font-bold mb-1">{title}</div>
                    <div className="text-zinc-400 text-[10px] leading-tight">{desc}</div>
                </div>
                {/* Arrow */}
                <div className="absolute left-1/2 -translate-x-1/2 -top-1 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-[#27272a]"></div>
            </div>
        </div>
    )
}

const ResizableHeader = ({ 
  label, 
  width, 
  onResize, 
  align = 'left' 
}: { 
  label: string, 
  width: number, 
  onResize: (w: number) => void,
  align?: 'left' | 'right' | 'center'
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const diff = e.clientX - startX.current;
        onResize(Math.max(50, startWidth.current + diff));
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return (
    <th className="relative p-4 border-b border-white/10 select-none group" style={{ width, textAlign: align }}>
      <span className="relative z-10">{label}</span>
      <div 
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cad-accent transition-colors z-20"
        onMouseDown={(e) => {
          setIsResizing(true);
          startX.current = e.clientX;
          startWidth.current = width;
        }}
      />
    </th>
  );
};

// 1. Geodésia Tool
const GeodesiaTool = ({ points }: { points: Point[] }) => {
  const [selectedPoint, setSelectedPoint] = useState(points[0].id);
  const p = points.find(pt => pt.id === selectedPoint) || points[0];
  const { lat, long } = fakeGeoConvert(p.n, p.e);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase">Ponto de Origem</label>
          <select 
            className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-white focus:border-cad-accent outline-none"
            value={selectedPoint}
            onChange={(e) => setSelectedPoint(e.target.value)}
          >
            {points.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase">Datum de Saída</label>
          <select className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-white focus:border-cad-accent outline-none">
            <option>SIRGAS 2000</option>
            <option>WGS 84</option>
            <option>SAD 69</option>
          </select>
        </div>
      </div>

      <div className="bg-zinc-900/50 p-4 rounded-xl border border-white/5 space-y-4">
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <span className="text-sm font-medium">Coordenadas UTM (Origem)</span>
        </div>
        <div className="grid grid-cols-2 gap-4 font-mono text-sm">
          <div>
            <span className="text-cad-accent block text-xs mb-1">NORTE (Y)</span>
            {p.n.toFixed(3)} m
          </div>
          <div>
            <span className="text-cad-accent block text-xs mb-1">LESTE (X)</span>
            {p.e.toFixed(3)} m
          </div>
        </div>
      </div>
      <div className="bg-cad-accent/10 p-4 rounded-xl border border-cad-accent/20 space-y-4">
        <div className="flex justify-between items-center border-b border-cad-accent/10 pb-2">
          <span className="text-sm font-bold text-cad-accent">Coordenadas Geodésicas (Calculado)</span>
        </div>
        <div className="grid grid-cols-2 gap-4 font-mono text-sm">
          <div><span className="text-zinc-400 block text-xs mb-1">LATITUDE</span>{lat.toFixed(8)}°</div>
          <div><span className="text-zinc-400 block text-xs mb-1">LONGITUDE</span>{long.toFixed(8)}°</div>
        </div>
      </div>
    </div>
  );
};

// 2. Memorial Tool
const MemorialTool = ({ points }: { points: Point[] }) => {
  const text = useMemo(() => {
    return `MEMORIAL DESCRITIVO\n\nImóvel: Fazenda Santa Maria\nProprietário: Cliente Exemplo LTDA\n\nDESCRIÇÃO:\nInicia-se no vértice ${points[0]?.name} (N=${points[0]?.n.toFixed(3)}, E=${points[0]?.e.toFixed(3)})...`;
  }, [points]);

  return (
    <div className="flex flex-col h-96">
      <div className="flex gap-2 mb-4">
        <button className="px-4 py-2 bg-cad-accent text-white rounded-lg text-sm font-bold shadow-lg">Gerar PDF</button>
      </div>
      <textarea className="flex-1 w-full bg-zinc-950 border border-white/10 rounded-xl p-4 font-mono text-sm text-zinc-300 resize-none" readOnly value={text} />
    </div>
  );
};

// 3. Perfil Tool
const PerfilTool = ({ points }: { points: Point[] }) => {
  const data = useMemo(() => points.map((p, i) => ({ name: p.name, dist: i * 20, cota: p.z, projected: p.z - Math.sin(i) * 2 })), [points]);
  return (
    <div className="h-96 w-full flex flex-col">
       <div className="flex justify-between mb-4"><div className="text-sm text-zinc-400">Perfil: <span className="text-white font-bold">Eixo Principal</span></div></div>
       <div className="flex-1 bg-zinc-900/50 rounded-xl border border-white/5 p-4 relative">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="dist" stroke="#666" tick={{fill: '#666', fontSize: 10}} />
              <YAxis domain={['auto', 'auto']} stroke="#666" tick={{fill: '#666', fontSize: 10}} />
              <RechartsTooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
              <Area type="monotone" dataKey="cota" stroke="#06b6d4" fillOpacity={0.3} fill="#06b6d4" strokeWidth={2} name="Terreno" />
              <Line type="monotone" dataKey="projected" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" name="Greide" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
       </div>
    </div>
  );
};

// 4. Volume Tool
const VolumeTool = ({ points }: { points: Point[] }) => {
  const [cotaPlato, setCotaPlato] = useState(102);
  const avgZ = points.reduce((acc, p) => acc + p.z, 0) / points.length;
  const area = 1540.50; 
  const diff = avgZ - cotaPlato;
  const volume = Math.abs(diff * area);
  const type = diff > 0 ? 'CORTE' : 'ATERRO';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
         <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase">Cota do Platô (m)</label>
              <input type="number" value={cotaPlato} onChange={(e) => setCotaPlato(Number(e.target.value))} className="w-full bg-zinc-900 border border-white/10 rounded-lg p-3 text-white text-right font-mono text-lg" />
            </div>
         </div>
         <div className="bg-zinc-900 p-6 rounded-xl border border-white/10 flex flex-col justify-center items-center text-center">
            <div className="text-xs font-bold text-zinc-500 uppercase mb-2">Volume Total Estimado</div>
            <div className="text-4xl font-black text-white font-mono mb-1">{volume.toFixed(2)} m³</div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${type === 'CORTE' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'}`}>{type} NECESSÁRIO</div>
         </div>
      </div>
    </div>
  );
};

const Logo = () => (
  <div className="h-16 flex items-center px-6 border-b border-white/5 gap-3">
    <div className="w-8 h-8 bg-cad-accent rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-cad-accent/20">
      <Hexagon size={20} className="fill-current" />
    </div>
    <div className="flex flex-col">
      <span className="text-lg font-bold text-white tracking-tight leading-none">GeoMaster</span>
      <span className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">Survey CAD</span>
    </div>
  </div>
);

// --- CSV Import Modal ---
const CSVImportModal = ({ onClose, onImport }: { onClose: () => void, onImport: (points: Point[]) => void }) => {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string[][]>([]);
    const [mappingName, setMappingName] = useState('');
    const [savedMappings, setSavedMappings] = useState<Record<string, CsvMapping>>(() => {
        const saved = localStorage.getItem('csv_mappings_db');
        return saved ? JSON.parse(saved) : {};
    });
    const [errors, setErrors] = useState<string[]>([]);
    
    // Default mapping
    const [mapping, setMapping] = useState<CsvMapping>({
        id: 0, name: 1, n: 2, e: 3, z: 4, desc: 5, separator: ';', hasHeader: true
    });

    const validateMapping = () => {
        const errs: string[] = [];
        const required = ['id', 'name', 'n', 'e', 'z', 'desc'];
        
        required.forEach(field => {
            const idx = mapping[field as keyof CsvMapping];
            if (typeof idx !== 'number' || isNaN(idx)) {
                errs.push(`Campo '${field}' deve ser um número.`);
            } else if (idx < 0) {
                errs.push(`Campo '${field}' não pode ser negativo.`);
            }
        });

        if (file && preview.length > 0) {
            const maxCol = preview[0].length - 1;
             required.forEach(field => {
                const idx = mapping[field as keyof CsvMapping] as number;
                if (idx > maxCol) {
                    errs.push(`Índice ${idx} do campo '${field}' excede colunas do arquivo (máx: ${maxCol}).`);
                }
             });
        }
        
        setErrors(errs);
        return errs.length === 0;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            setFile(f);
            setErrors([]);
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target?.result as string;
                const lines = text.split('\n').slice(0, 5).map(l => l.split(mapping.separator));
                setPreview(lines);
            };
            reader.readAsText(f);
        }
    };

    const handleSaveMapping = () => {
        if (!validateMapping()) return;
        if (!mappingName) return;
        const newMappings = { ...savedMappings, [mappingName]: mapping };
        setSavedMappings(newMappings);
        localStorage.setItem('csv_mappings_db', JSON.stringify(newMappings));
        setMappingName('');
    };

    const handleLoadMapping = (name: string) => {
        if (savedMappings[name]) {
            setMapping(savedMappings[name]);
            setErrors([]);
        }
    };

    const handleImport = () => {
        if (!file) return;
        if (!validateMapping()) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target?.result as string;
            const lines = text.split('\n');
            const newPoints: Point[] = [];
            const startIdx = mapping.hasHeader ? 1 : 0;
            const today = new Date().toISOString().split('T')[0];
            const importErrors: string[] = [];

            for (let i = startIdx; i < lines.length; i++) {
                const cols = lines[i].split(mapping.separator);
                if (cols.length < 3) continue;

                const n = parseFloat(cols[mapping.n]);
                const e = parseFloat(cols[mapping.e]);
                const z = parseFloat(cols[mapping.z]);

                if (!isValidCoordinate(n) || !isValidCoordinate(e)) {
                    importErrors.push(`Linha ${i + 1}: Coordenadas inválidas (NaN)`);
                    continue;
                }
                if (!isValidNorth(n)) {
                     importErrors.push(`Linha ${i + 1}: Norte (${n}) fora do intervalo esperado (6M-10M)`);
                     continue;
                }
                if (!isValidEast(e)) {
                     importErrors.push(`Linha ${i + 1}: Leste (${e}) fora do intervalo esperado (100k-900k)`);
                     continue;
                }

                newPoints.push({
                    id: cols[mapping.id] || `P-${i}`,
                    name: cols[mapping.name] || `P-${i}`,
                    n, e, z: isValidCoordinate(z) ? z : 0,
                    desc: cols[mapping.desc] || '',
                    date: today
                });
            }

            if (importErrors.length > 0 && newPoints.length === 0) {
                setErrors(importErrors.slice(0, 5).concat(importErrors.length > 5 ? [`...e mais ${importErrors.length - 5} erros.`] : []));
                return;
            } else if (importErrors.length > 0) {
                 alert(`Importação parcial realizada. ${importErrors.length} linhas ignoradas.`);
            }

            onImport(newPoints);
            onClose();
        };
        reader.readAsText(file);
    };

    return (
        <ModalWindow title="Importar Arquivo CSV" icon={Upload} onClose={onClose}>
            <div className="space-y-6">
                 {errors.length > 0 && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-red-400 font-bold text-xs mb-1">
                            <AlertCircle size={14}/> Erros de Validação
                        </div>
                        <ul className="list-disc list-inside text-xs text-red-300">
                            {errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </div>
                 )}

                 {/* Saved Mappings Control */}
                 <div className="bg-zinc-900 p-4 rounded-xl border border-white/10 flex gap-4 items-end">
                    <div className="flex-1 space-y-2">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Mapeamentos Salvos</label>
                        <select onChange={(e) => handleLoadMapping(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded p-2 text-xs text-white">
                            <option value="">Selecione um perfil...</option>
                            {Object.keys(savedMappings).map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 space-y-2">
                         <label className="text-[10px] font-bold text-zinc-500 uppercase">Salvar Configuração Atual</label>
                         <div className="flex gap-2">
                            <input type="text" placeholder="Nome do perfil..." value={mappingName} onChange={e => setMappingName(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded p-2 text-xs text-white" />
                            <button onClick={handleSaveMapping} className="p-2 bg-zinc-800 text-white rounded hover:bg-cad-accent transition-colors"><Save size={14}/></button>
                         </div>
                    </div>
                 </div>

                <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-cad-accent transition-colors">
                    <input type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" id="csv-upload" />
                    <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
                        <Upload size={32} className="text-zinc-500 mb-2" />
                        <span className="text-sm font-bold text-white">Clique para selecionar</span>
                        <span className="text-xs text-zinc-500">Arquivos .CSV ou .TXT</span>
                    </label>
                    {file && <div className="mt-4 text-xs bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded inline-block">{file.name}</div>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500">Separador</label>
                      <select value={mapping.separator} onChange={e => setMapping({...mapping, separator: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white">
                          <option value=";">Ponto e Vírgula (;)</option>
                          <option value=",">Vírgula (,)</option>
                          <option value="\t">Tabulação</option>
                      </select>
                   </div>
                   <div className="flex items-center gap-2 pt-6">
                       <input type="checkbox" checked={mapping.hasHeader} onChange={e => setMapping({...mapping, hasHeader: e.target.checked})} className="rounded bg-zinc-900 border-white/10" />
                       <label className="text-sm text-zinc-300">Ignorar primeira linha (Cabeçalho)</label>
                   </div>
                </div>

                {preview.length > 0 && (
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-white uppercase border-b border-white/10 pb-2">Mapeamento de Colunas</h4>
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { k: 'id', l: 'ID / Índice' }, { k: 'name', l: 'Nome do Ponto' },
                                { k: 'n', l: 'Norte (Y)' }, { k: 'e', l: 'Leste (X)' },
                                { k: 'z', l: 'Cota (Z)' }, { k: 'desc', l: 'Descrição' }
                            ].map((f) => (
                                <div key={f.k} className="space-y-1">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase">{f.l}</label>
                                    <input 
                                        type="number" 
                                        value={mapping[f.k as keyof CsvMapping] as number}
                                        onChange={e => setMapping({...mapping, [f.k]: parseInt(e.target.value)})}
                                        className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-xs text-white"
                                        placeholder="Col Index"
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 bg-black/30 p-2 rounded text-xs font-mono text-zinc-400 overflow-x-auto">
                            <div className="mb-1 text-zinc-500">Prévia (5 linhas):</div>
                            {preview.map((row, i) => (
                                <div key={i} className="whitespace-nowrap">{row.join(' | ')}</div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
                    <button onClick={handleImport} className="px-4 py-2 bg-cad-accent text-white rounded font-bold text-sm hover:brightness-110 shadow-lg">Importar Dados</button>
                </div>
            </div>
        </ModalWindow>
    )
}

// --- New Point Modal with Validation ---
const NewPointModal = ({ onClose, onSave }: { onClose: () => void, onSave: (p: Point) => void }) => {
    const [form, setForm] = useState({ name: '', n: '', e: '', z: '', desc: '' });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleSubmit = () => {
        const newErrors: Record<string, string> = {};
        if (!form.name) newErrors.name = 'Nome é obrigatório';
        
        const n = parseFloat(form.n);
        const e = parseFloat(form.e);
        const z = parseFloat(form.z);

        if (!isValidCoordinate(form.n)) newErrors.n = 'Norte inválido';
        else if (!isValidNorth(n)) newErrors.n = 'Norte fora da faixa UTM (6M-10M)';

        if (!isValidCoordinate(form.e)) newErrors.e = 'Leste inválido';
        else if (!isValidEast(e)) newErrors.e = 'Leste fora da faixa UTM (100k-900k)';

        if (!isValidCoordinate(form.z)) newErrors.z = 'Cota inválida';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        onSave({
            id: `M-${Date.now()}`,
            name: form.name,
            n: n,
            e: e,
            z: z,
            desc: form.desc,
            date: new Date().toISOString().split('T')[0]
        });
        onClose();
    };

    return (
        <ModalWindow title="Adicionar Novo Ponto" icon={Plus} onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Nome do Ponto</label>
                    <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white" />
                    {errors.name && <span className="text-red-500 text-xs">{errors.name}</span>}
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Norte (Y)</label>
                        <input type="number" value={form.n} onChange={e => setForm({...form, n: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white font-mono" />
                        {errors.n && <span className="text-red-500 text-xs">{errors.n}</span>}
                    </div>
                    <div>
                        <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Leste (X)</label>
                        <input type="number" value={form.e} onChange={e => setForm({...form, e: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white font-mono" />
                        {errors.e && <span className="text-red-500 text-xs">{errors.e}</span>}
                    </div>
                    <div>
                        <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Cota (Z)</label>
                        <input type="number" value={form.z} onChange={e => setForm({...form, z: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white font-mono" />
                         {errors.z && <span className="text-red-500 text-xs">{errors.z}</span>}
                    </div>
                </div>
                <div>
                    <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Descrição</label>
                    <input type="text" value={form.desc} onChange={e => setForm({...form, desc: e.target.value})} className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-sm text-white" />
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-cad-accent text-white rounded font-bold text-sm hover:brightness-110 shadow-lg">Adicionar</button>
                </div>
            </div>
        </ModalWindow>
    )
}

// --- Version Control Modal ---
const VersionControlModal = ({ onClose, currentPoints, onLoad }: { onClose: () => void, currentPoints: Point[], onLoad: (pts: Point[]) => void }) => {
    const [versions, setVersions] = useState<ProjectVersion[]>(() => {
        const saved = localStorage.getItem('project_versions');
        return saved ? JSON.parse(saved) : [];
    });
    const [newVersionName, setNewVersionName] = useState('');

    const saveVersion = () => {
        if (!newVersionName.trim()) return;
        const newVersion: ProjectVersion = {
            id: Date.now().toString(),
            name: newVersionName,
            date: new Date().toLocaleString(),
            points: currentPoints
        };
        const updated = [newVersion, ...versions];
        setVersions(updated);
        localStorage.setItem('project_versions', JSON.stringify(updated));
        setNewVersionName('');
    };

    const loadVersion = (v: ProjectVersion) => {
        if(confirm(`Carregar versão "${v.name}"? Dados não salvos serão perdidos.`)) {
            onLoad(v.points);
            onClose();
        }
    };

    const deleteVersion = (id: string) => {
        const updated = versions.filter(v => v.id !== id);
        setVersions(updated);
        localStorage.setItem('project_versions', JSON.stringify(updated));
    };

    return (
        <ModalWindow title="Controle de Versão" icon={History} onClose={onClose}>
            <div className="space-y-6">
                <div className="bg-zinc-900 p-4 rounded-xl border border-white/10 space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Salvar Snapshot Atual</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            placeholder="Nome da versão (ex: Final, Revisão 1)..." 
                            value={newVersionName} 
                            onChange={e => setNewVersionName(e.target.value)} 
                            className="flex-1 bg-black/30 border border-white/10 rounded p-2 text-sm text-white outline-none focus:border-cad-accent"
                        />
                        <button onClick={saveVersion} className="px-4 bg-cad-accent text-white rounded font-bold text-sm hover:brightness-110">Salvar</button>
                    </div>
                </div>

                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-500 uppercase border-b border-white/10 pb-2">Histórico de Versões</h4>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {versions.length === 0 && <div className="text-zinc-500 text-sm py-4 text-center italic">Nenhuma versão salva.</div>}
                        {versions.map(v => (
                            <div key={v.id} className="flex items-center justify-between p-3 bg-zinc-900/50 hover:bg-zinc-800 rounded-lg border border-white/5 group transition-colors">
                                <div>
                                    <div className="text-sm font-bold text-white">{v.name}</div>
                                    <div className="text-xs text-zinc-500">{v.date} • {v.points.length} pontos</div>
                                </div>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => loadVersion(v)} className="p-1.5 bg-emerald-500/20 text-emerald-500 rounded hover:bg-emerald-500/30" title="Carregar"><RefreshCw size={14}/></button>
                                    <button onClick={() => deleteVersion(v.id)} className="p-1.5 bg-red-500/20 text-red-500 rounded hover:bg-red-500/30" title="Excluir"><Trash2 size={14}/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </ModalWindow>
    );
};

// --- Visual Settings Modal ---
const SettingsModal = ({ 
    settings, onSave, onClose, layerConfigs, setLayerConfigs 
}: { 
    settings: VisualSettings, 
    onSave: (s: VisualSettings) => void, 
    onClose: () => void,
    layerConfigs: Record<string, LayerConfig>,
    setLayerConfigs: React.Dispatch<React.SetStateAction<Record<string, LayerConfig>>>
}) => {
    const [local, setLocal] = useState(settings);
    
    return (
        <ModalWindow title="Configurações Visuais" icon={Palette} onClose={onClose}>
            <div className="space-y-6">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Tamanho do Ponto</label>
                        <div className="flex items-center gap-4">
                            <input type="range" min="1" max="10" step="0.5" value={local.pointSize} onChange={e => setLocal({...local, pointSize: Number(e.target.value)})} className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"/>
                            <span className="text-sm font-mono text-white w-8">{local.pointSize}px</span>
                        </div>
                    </div>
                    <div className="h-px bg-white/10"></div>
                    <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase">Cor de Seleção</label>
                            <div className="flex items-center gap-2">
                                <input type="color" value={local.selectedColor} onChange={e => setLocal({...local, selectedColor: e.target.value})} className="w-8 h-8 rounded border-none bg-transparent cursor-pointer" />
                                <span className="text-xs text-zinc-400 uppercase">{local.selectedColor}</span>
                            </div>
                        </div>
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase">Cor de Hover</label>
                            <div className="flex items-center gap-2">
                                <input type="color" value={local.hoverColor} onChange={e => setLocal({...local, hoverColor: e.target.value})} className="w-8 h-8 rounded border-none bg-transparent cursor-pointer" />
                                <span className="text-xs text-zinc-400 uppercase">{local.hoverColor}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="h-px bg-white/10"></div>
                    <div>
                        <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Cores das Camadas (Layer)</h4>
                        <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-2">
                            {Object.entries(layerConfigs).map(([desc, config]) => (
                                <div key={desc} className="flex items-center justify-between bg-zinc-900 p-2 rounded border border-white/5">
                                    <span className="text-xs text-white truncate w-24">{desc}</span>
                                    <input type="color" value={config.color} onChange={(e) => setLayerConfigs(prev => ({...prev, [desc]: {...prev[desc], color: e.target.value}}))} className="w-6 h-6 rounded border-none bg-transparent cursor-pointer" />
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
                 <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
                    <button onClick={() => { onSave(local); onClose(); }} className="px-4 py-2 bg-cad-accent text-white rounded font-bold text-sm hover:brightness-110 shadow-lg">Salvar Preferências</button>
                </div>
            </div>
        </ModalWindow>
    )
}

// --- Main 3D Scene Component ---
const Scene3D = ({ points, layers }: { 
  points: Point[], 
  layers: Record<string, LayerConfig>
}) => {
  const centerN = useMemo(() => points.reduce((acc, p) => acc + p.n, 0) / points.length, [points]);
  const centerE = useMemo(() => points.reduce((acc, p) => acc + p.e, 0) / points.length, [points]);
  const minZ = useMemo(() => Math.min(...points.map(p => p.z)), [points]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[100, 100, 100]} intensity={1} />
      <gridHelper args={[200, 20, 0x444444, 0x222222]} position={[0, -2, 0]} />
      <OrbitControls makeDefault />

      {points.map((p) => {
        const config = layers[p.desc] || { color: '#ffffff', visible: true };
        if (!config.visible) return null;
        const x = (p.e - centerE);
        const y = (p.z - minZ) * 2;
        const z = -(p.n - centerN);

        return (
          <group key={p.id} position={[x, y, z]}>
            <mesh>
              <sphereGeometry args={[0.8, 16, 16]} />
              <meshStandardMaterial color={config.color} />
            </mesh>
            <Html distanceFactor={15}>
              <div className="bg-black/80 text-white text-[10px] px-1 rounded pointer-events-none whitespace-nowrap border border-white/10">
                {p.name}
              </div>
            </Html>
            <mesh position={[0, -y/2 - 1, 0]}>
               <cylinderGeometry args={[0.05, 0.05, y + 2, 4]} />
               <meshBasicMaterial color={config.color} opacity={0.3} transparent />
            </mesh>
          </group>
        );
      })}
       <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={points.filter(p => layers[p.desc]?.visible).length}
              array={new Float32Array(points.flatMap(p => {
                 if (!layers[p.desc]?.visible) return [];
                 return [(p.e - centerE), (p.z - minZ) * 2, -(p.n - centerN)];
              }))}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" opacity={0.1} transparent />
       </line>
    </>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState<'dados' | 'mapa' | 'ferramentas' | 'relatorios'>('dados');
  const [points, setPoints] = useState<Point[]>(INITIAL_POINTS);
  const [searchTerm, setSearchTerm] = useState('');
  
  // -- Tools State --
  const [activeTool, setActiveTool] = useState<ToolType>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNewPointModal, setShowNewPointModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitCandidate, setSplitCandidate] = useState<{idx: number, point: Point} | null>(null);

  // -- Map State --
  const [is3DMode, setIs3DMode] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [snapMidpoint, setSnapMidpoint] = useState<{ point: {x: number, y: number}, label: string } | null>(null);
  const [snapGrid, setSnapGrid] = useState<{ point: {x: number, y: number} } | null>(null);
  const [showContours, setShowContours] = useState(false);
  const [showTIN, setShowTIN] = useState(false);
  const [movingPointId, setMovingPointId] = useState<string | null>(null);
  const [contourInterval, setContourInterval] = useState(1);
  const [cursorTooltip, setCursorTooltip] = useState({ x: 0, y: 0, text: '' });
  
  // Civil Tools State
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const [alignmentMode, setAlignmentMode] = useState(false);
  const [alignmentPoints, setAlignmentPoints] = useState<Point[]>([]);

  // Filter State
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // Visual Settings
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(() => {
      const saved = localStorage.getItem('visual_settings');
      return saved ? JSON.parse(saved) : { pointSize: 4, selectedColor: '#ffffff', hoverColor: '#fbbf24', snapColor: '#facc15' };
  });

  const updateVisualSettings = (newSettings: VisualSettings) => {
      setVisualSettings(newSettings);
      localStorage.setItem('visual_settings', JSON.stringify(newSettings));
  };
  
  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Snap Settings
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
      enabled: true,
      vertices: true,
      midpoints: true,
      grid: false,
      gridInterval: 5,
      distance: 15
  });
  
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewNameInput, setViewNameInput] = useState('');
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // -- Table Column Widths --
  const [colWidths, setColWidths] = useState({ id: 60, name: 100, n: 120, e: 120, z: 100, desc: 150 });
  // -- Z Transform --
  const [zTransform, setZTransform] = useState({ base: 0, multiplier: 1 });

  // -- Layers State --
  const uniqueDescs = useMemo(() => [...new Set(points.map(p => p.desc))], [points]);
  const [layerConfigs, setLayerConfigs] = useState<Record<string, LayerConfig>>(() => {
    // Load from local storage or default
    const saved = localStorage.getItem('layer_configs');
    if (saved) {
        // Merge with current descs to ensure we have all keys
        const parsed = JSON.parse(saved);
        const merged: Record<string, LayerConfig> = {};
        const colors = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        uniqueDescs.forEach((desc, i) => {
            merged[desc] = parsed[desc] || { color: colors[i % colors.length], visible: true };
        });
        return merged;
    }
    const initial: Record<string, LayerConfig> = {};
    const colors = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    uniqueDescs.forEach((desc, i) => {
      initial[desc] = { color: colors[i % colors.length], visible: true };
    });
    return initial;
  });

  // Persist Layer Configs
  useEffect(() => {
      localStorage.setItem('layer_configs', JSON.stringify(layerConfigs));
  }, [layerConfigs]);

  const filteredPoints = useMemo(() => {
    return points.filter(p => {
        const matchText = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.desc.toLowerCase().includes(searchTerm.toLowerCase());
        const matchDate = (!dateRange.start || p.date >= dateRange.start) && (!dateRange.end || p.date <= dateRange.end);
        return matchText && matchDate;
    });
  }, [points, searchTerm, dateRange]);

  // --- Helpers ---
  const getMapExtent = () => {
    const ns = points.map(p => p.n);
    const es = points.map(p => p.e);
    return {
        minN: Math.min(...ns), maxN: Math.max(...ns),
        minE: Math.min(...es), maxE: Math.max(...es)
    };
  };

  const normalizePoint = (p: Point) => {
      const mapExtent = getMapExtent();
      const rangeE = (mapExtent.maxE - mapExtent.minE) || 100;
      const rangeN = (mapExtent.maxN - mapExtent.minN) || 100;
      const x = ((p.e - mapExtent.minE) / rangeE) * 700 + 50;
      const y = 550 - ((p.n - mapExtent.minN) / rangeN) * 500;
      return { x, y };
  };

  const denormalize = (x: number, y: number) => {
      const mapExtent = getMapExtent();
      const rangeE = (mapExtent.maxE - mapExtent.minE) || 100;
      const rangeN = (mapExtent.maxN - mapExtent.minN) || 100;
      
      const e = ((x - 50) / 700) * rangeE + mapExtent.minE;
      const n = mapExtent.minN + ((550 - y) / 500) * rangeN;
      return { e, n };
  };

  const handleCopyCoords = (p: Point) => {
    const text = `N: ${p.n.toFixed(3)}, E: ${p.e.toFixed(3)}, Z: ${p.z.toFixed(3)}`;
    navigator.clipboard.writeText(text);
  };

  const generateKML = (selectionOnly: boolean = false) => {
      // (Implementation same as previous version)
      let pointsToExport = points;
      if (selectionOnly) {
          if (selectedIds.size === 0) {
              alert("Nenhum item selecionado para exportar.");
              return;
          }
          pointsToExport = points.filter(p => selectedIds.has(p.id));
      }

      let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${selectionOnly ? 'Seleção Exportada' : 'Projeto Completo'}</name>
    <Style id="polyStyle">
      <LineStyle>
        <color>ff00ffff</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>7f00ff00</color>
      </PolyStyle>
    </Style>
    ${(Object.entries(layerConfigs) as [string, LayerConfig][]).map(([desc, config]) => `
    <Style id="style-${desc.replace(/\s+/g, '-')}">
      <IconStyle>
        <color>${hexToKmlColor(config.color)}</color>
        <scale>1.1</scale>
      </IconStyle>
      <LabelStyle>
        <scale>0.8</scale>
      </LabelStyle>
    </Style>`).join('')}
    <Placemark>
      <name>Polígono</name>
      <styleUrl>#polyStyle</styleUrl>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
`;
      pointsToExport.forEach(p => {
          if (layerConfigs[p.desc]?.visible) {
            const { lat, long } = fakeGeoConvert(p.n, p.e);
            kml += `              ${long.toFixed(6)},${lat.toFixed(6)},${p.z}\n`;
          }
      });
      if (pointsToExport.length > 2) {
           const p0 = pointsToExport[0];
           const { lat, long } = fakeGeoConvert(p0.n, p0.e);
           kml += `              ${long.toFixed(6)},${lat.toFixed(6)},${p0.z}\n`;
      }

      kml += `            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
      ${pointsToExport.map(p => {
         const { lat, long } = fakeGeoConvert(p.n, p.e);
         return `
         <Placemark>
            <name>${p.name}</name>
            <description>${p.desc}</description>
            <styleUrl>#style-${p.desc.replace(/\s+/g, '-')}</styleUrl>
            <Point>
                <coordinates>${long.toFixed(6)},${lat.toFixed(6)},${p.z}</coordinates>
            </Point>
         </Placemark>
         `;
      }).join('')}
    </Placemark>
  </Document>
</kml>`;
    
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selectionOnly ? "selecao.kml" : "projeto_completo.kml";
    link.click();
  };

  // --- TIN & Contour Logic ---
  const tinMesh = useMemo(() => {
      // Simplified Delaunay approximation (k-nearest neighbors) for visualization
      const edges: Edge[] = [];
      const connected = new Set<string>();

      points.forEach(p1 => {
          if (!layerConfigs[p1.desc]?.visible) return;
          
          // Find 3 nearest neighbors
          const neighbors = points
              .filter(p2 => p2.id !== p1.id && layerConfigs[p2.desc]?.visible)
              .map(p2 => ({
                  p: p2,
                  dist: Math.sqrt(Math.pow(p2.n - p1.n, 2) + Math.pow(p2.e - p1.e, 2))
              }))
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 3);

          neighbors.forEach(n => {
              const id1 = [p1.id, n.p.id].sort().join('-');
              if (!connected.has(id1)) {
                  edges.push({ p1, p2: n.p });
                  connected.add(id1);
              }
          });
      });
      return edges;
  }, [points, layerConfigs]);

  const refinedContours = useMemo(() => {
      if (!showContours) return [];
      const segments: {z: number, p1: {x:number, y:number}, p2: {x:number, y:number}}[] = [];
      
      points.forEach(p1 => {
           if (!layerConfigs[p1.desc]?.visible) return;
           // Find neighbors used in TIN
           const neighbors = tinMesh
                .filter(e => e.p1.id === p1.id || e.p2.id === p1.id)
                .map(e => e.p1.id === p1.id ? e.p2 : e.p1);
           
           for(let i=0; i<neighbors.length; i++) {
               for(let j=i+1; j<neighbors.length; j++) {
                   const p2 = neighbors[i];
                   const p3 = neighbors[j];
                   // Check if p2 and p3 are connected in mesh
                   const isConnected = tinMesh.some(e => (e.p1.id === p2.id && e.p2.id === p3.id) || (e.p1.id === p3.id && e.p2.id === p2.id));
                   
                   if (isConnected) {
                       // We have a triangle p1-p2-p3.
                       const zMin = Math.min(p1.z, p2.z, p3.z);
                       const zMax = Math.max(p1.z, p2.z, p3.z);
                       
                       const startZ = Math.ceil(zMin / contourInterval) * contourInterval;
                       
                       for (let z = startZ; z <= zMax; z += contourInterval) {
                           // Find intersections on edges
                           const intersections = [];
                           
                           // Edge p1-p2
                           if ((p1.z <= z && p2.z > z) || (p2.z <= z && p1.z > z)) {
                               const t = (z - p1.z) / (p2.z - p1.z);
                               const n1 = normalizePoint(p1);
                               const n2 = normalizePoint(p2);
                               intersections.push({ x: n1.x + (n2.x - n1.x)*t, y: n1.y + (n2.y - n1.y)*t });
                           }
                           // Edge p2-p3
                           if ((p2.z <= z && p3.z > z) || (p3.z <= z && p2.z > z)) {
                               const t = (z - p2.z) / (p3.z - p2.z);
                               const n1 = normalizePoint(p2);
                               const n2 = normalizePoint(p3);
                               intersections.push({ x: n1.x + (n2.x - n1.x)*t, y: n1.y + (n2.y - n1.y)*t });
                           }
                           // Edge p3-p1
                           if ((p3.z <= z && p1.z > z) || (p1.z <= z && p3.z > z)) {
                               const t = (z - p3.z) / (p1.z - p3.z);
                               const n1 = normalizePoint(p3);
                               const n2 = normalizePoint(p1);
                               intersections.push({ x: n1.x + (n2.x - n1.x)*t, y: n1.y + (n2.y - n1.y)*t });
                           }
                           
                           if (intersections.length === 2) {
                               segments.push({ z, p1: intersections[0], p2: intersections[1] });
                           }
                       }
                   }
               }
           }
      });
      return segments;
  }, [points, tinMesh, showContours, contourInterval]);


  // --- Actions ---
  const handleExportCSV = (selectionOnly: boolean = false) => {
    const headers = "ID;Nome;Norte(Y);Leste(X);Cota(Z);Descrição;Data\n";
    let pts = filteredPoints;
    if (selectionOnly) {
         if (selectedIds.size === 0) return; // Silent return or could alert
         pts = points.filter(p => selectedIds.has(p.id));
    }
    const rows = pts.map(p => `${p.id};${p.name};${p.n.toFixed(3)};${p.e.toFixed(3)};${p.z.toFixed(3)};${p.desc};${p.date}`).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split('T')[0];
    const projectName = "Projeto_GeoMaster";
    link.download = `${projectName}_${dateStr}${selectionOnly ? '_selecao' : ''}.csv`;
    link.click();
  };

  const handleApplyZTransform = () => {
      if (confirm('Isso recalculará a cota (Z) de TODOS os pontos. Deseja continuar?')) {
          setPoints(prev => prev.map(p => ({
              ...p,
              z: (p.z * zTransform.multiplier) + zTransform.base
          })));
          setZTransform({ base: 0, multiplier: 1 }); // Reset after apply
      }
  };

  const handleViewOnMap = (p: Point) => {
    setActiveTab('mapa');
    setIs3DMode(false);
    setMapZoom(2);
    setMapPan({ x: -200, y: -100 });
    setSelectedIds(new Set([p.id]));
  };

  const handleSaveView = () => {
    if (!viewNameInput) return;
    setSavedViews([...savedViews, { id: Date.now().toString(), name: viewNameInput, zoom: mapZoom, pan: { ...mapPan } }]);
    setViewNameInput('');
    setShowSaveViewDialog(false);
  };

  const handleRestoreView = (viewId: string) => {
    const view = savedViews.find(v => v.id === viewId);
    if (view) { setMapZoom(view.zoom); setMapPan(view.pan); }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    setMapZoom(prev => Math.min(Math.max(prev * scale, 0.5), 10));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldMouseX = ((e.clientX - rect.left) - mapPan.x) / mapZoom;
    const worldMouseY = ((e.clientY - rect.top) - mapPan.y) / mapZoom;

    // Moving Point Logic
    if (movingPointId) {
        const newCoords = denormalize(worldMouseX, worldMouseY);
        setPoints(prev => prev.map(p => 
            p.id === movingPointId 
            ? { ...p, n: newCoords.n, e: newCoords.e } 
            : p
        ));
        return;
    }

    if (isDragging) {
      setMapPan({ x: mapPan.x + (e.clientX - dragStart.x), y: mapPan.y + (e.clientY - dragStart.y) });
      setDragStart({ x: e.clientX, y: e.clientY });
    }
    
    // ... Splitting & Snap Logic ...
    let foundVertex = false;

    // 1. Splitting Logic (Line Detection)
    if (isSplitting) {
        let bestSplit: {idx: number, point: Point, dist: number} | null = null;
        for(let i=0; i<points.length-1; i++) {
            const p1 = normalizePoint(points[i]);
            const p2 = normalizePoint(points[i+1]);
            const proj = projectPointOnSegment(worldMouseX, worldMouseY, p1.x, p1.y, p2.x, p2.y);
            const dist = Math.sqrt((proj.x - worldMouseX)**2 + (proj.y - worldMouseY)**2);
            
            if(layerConfigs[points[i].desc]?.visible && dist < 20/mapZoom) {
                if (!bestSplit || dist < bestSplit.dist) {
                    const worldCoords = denormalize(proj.x, proj.y);
                    bestSplit = {
                        idx: i,
                        dist,
                        point: {
                            id: `S-${Date.now()}`,
                            name: `S-${points.length+1}`,
                            n: worldCoords.n,
                            e: worldCoords.e,
                            z: (points[i].z + points[i+1].z)/2,
                            desc: points[i].desc,
                            date: new Date().toISOString().split('T')[0]
                        }
                    }
                }
            }
        }
        setSplitCandidate(bestSplit ? { idx: bestSplit.idx, point: bestSplit.point } : null);
        
        setCursorTooltip({ 
            x: e.clientX, 
            y: e.clientY, 
            text: 'Ferramenta: Dividir' 
        });
        return;
    }

    // 2. Snap Logic
    if (snapSettings.enabled) {
        let closest: Point | null = null;
        let minDist = snapSettings.distance / mapZoom;

        // Vertices Snap
        if (snapSettings.vertices) {
            points.forEach(p => {
                if(!layerConfigs[p.desc]?.visible) return;
                const { x, y } = normalizePoint(p);
                const dist = Math.sqrt((x - worldMouseX) ** 2 + (y - worldMouseY) ** 2);
                if (dist < minDist) { minDist = dist; closest = p; }
            });
        }
        if (closest) {
            setSnapPoint(closest);
            setSnapMidpoint(null);
            setSnapGrid(null);
            foundVertex = true;
        } else {
            setSnapPoint(null);
        }

        // Midpoint Snap
        if (!foundVertex && snapSettings.midpoints) {
            let closestMid: { point: {x:number, y:number}, label: string, dist: number} | null = null;
            for (let i = 0; i < points.length - 1; i++) {
                if (!layerConfigs[points[i].desc]?.visible) continue;
                const p1 = normalizePoint(points[i]);
                const p2 = normalizePoint(points[i+1]);
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const dist = Math.sqrt((midX - worldMouseX)**2 + (midY - worldMouseY)**2);
                
                if (dist < minDist) {
                    minDist = dist;
                    closestMid = { point: {x: midX, y: midY}, label: `Mid(${points[i].name}-${points[i+1].name})`, dist };
                }
            }
            setSnapMidpoint(closestMid);
            if (closestMid) setSnapGrid(null);
        } else {
            setSnapMidpoint(null);
        }

        // Grid Snap (Real-world coordinates)
        if (!foundVertex && !snapMidpoint && snapSettings.grid) {
            // Get Mouse World Position
            const worldPos = denormalize(worldMouseX, worldMouseY);
            const gridInterval = snapSettings.gridInterval || 5; 
            const snappedN = Math.round(worldPos.n / gridInterval) * gridInterval;
            const snappedE = Math.round(worldPos.e / gridInterval) * gridInterval;
            
            // Convert snapped world pos back to screen for distance check
            const screenPos = normalizePoint({ n: snappedN, e: snappedE, id: 'temp', name: '', z: 0, desc: '', date: '' });
            
            // Allow snap if within distance
            const dist = Math.sqrt((worldMouseX - screenPos.x)**2 + (worldMouseY - screenPos.y)**2);

            if (dist < minDist) {
                    setSnapGrid({ point: {x: screenPos.x, y: screenPos.y} });
            } else {
                    setSnapGrid(null);
            }
        } else {
            setSnapGrid(null);
        }
    } else {
        setSnapPoint(null);
        setSnapMidpoint(null);
        setSnapGrid(null);
    }

    // Update Tooltip Text
    let toolText = '';
    if (measureMode) toolText = 'Ferramenta: Medição';
    else if (alignmentMode) toolText = 'Ferramenta: Eixo';
    else if (isSplitting) toolText = 'Ferramenta: Dividir';
    else if (movingPointId) toolText = 'Ação: Mover Ponto';
    
    // Snap overrides generic tool text if active (precision is key)
    if (snapPoint) toolText = `SNAP: ${snapPoint.name}`;
    else if (snapMidpoint) toolText = `SNAP: ${snapMidpoint.label}`;
    else if (snapGrid) toolText = 'SNAP: GRADE';

    setCursorTooltip({ 
        x: e.clientX, 
        y: e.clientY, 
        text: toolText 
    });
  };

  const handleMapMouseDown = (e: React.MouseEvent, p?: Point) => {
      // Measurement Mode
      if (measureMode) {
          e.stopPropagation();
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const worldMouseX = ((e.clientX - rect.left) - mapPan.x) / mapZoom;
          const worldMouseY = ((e.clientY - rect.top) - mapPan.y) / mapZoom;
          const clickPos = p || { ...denormalize(worldMouseX, worldMouseY), id: 'temp-measure', name: 'Temp', z: 0, desc: '', date: '' };
          
          if (measurePoints.length >= 2) {
              setMeasurePoints([clickPos]);
          } else {
              setMeasurePoints([...measurePoints, clickPos]);
          }
          return;
      }

      // Alignment Mode
      if (alignmentMode) {
          e.stopPropagation();
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const worldMouseX = ((e.clientX - rect.left) - mapPan.x) / mapZoom;
          const worldMouseY = ((e.clientY - rect.top) - mapPan.y) / mapZoom;
          const clickPos = p || { ...denormalize(worldMouseX, worldMouseY), id: `align-${Date.now()}`, name: `E-${alignmentPoints.length}`, z: 0, desc: 'Eixo', date: '' };
          
          setAlignmentPoints([...alignmentPoints, clickPos]);
          return;
      }

      if (p) {
          e.stopPropagation();
          // Selection Logic with Shift
          if (e.shiftKey) {
              const newSet = new Set(selectedIds);
              if (newSet.has(p.id)) newSet.delete(p.id);
              else newSet.add(p.id);
              setSelectedIds(newSet);
          } else {
              // If not shift, allow selection if not already selected, but prepare for move
              if (!selectedIds.has(p.id)) {
                  setSelectedIds(new Set([p.id]));
              }
              setMovingPointId(p.id);
          }
      } else {
          // Empty space click
          setIsDragging(true); 
          setDragStart({ x: e.clientX, y: e.clientY });
          if (!isDragging) {
              setSelectedIds(new Set());
          }
      }
  };

  const handleMapMouseUp = () => {
      setIsDragging(false);
      setMovingPointId(null);
  };

  const confirmSplit = () => {
       // Handled in click
  };
  
  const handleMapClick = (e: React.MouseEvent) => {
       if (isSplitting && splitCandidate) {
          if (confirm('Deseja dividir o segmento e criar um novo vértice aqui?')) {
              const newPoints = [...points];
              newPoints.splice(splitCandidate.idx + 1, 0, splitCandidate.point);
              setPoints(newPoints);
              setIsSplitting(false);
              setSplitCandidate(null);
          }
      }
  };

  // --- Renderers ---
  const renderReports = () => (
      <div className="flex flex-col h-full animate-in fade-in duration-300">
         <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
               <FileText className="text-cad-accent" /> Relatórios & Memoriais
            </h2>
         </div>
         <div className="grid grid-cols-2 gap-8 h-full">
            <div className="flex flex-col bg-zinc-900 border border-white/10 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4 text-zinc-300 font-bold border-b border-white/10 pb-4">
                    <FileDown size={20} className="text-cad-accent" /> Central de Exportação
                </div>
                <div className="space-y-4">
                     <button onClick={() => handleExportCSV(false)} className="w-full flex items-center justify-between p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-white/5 transition-colors group">
                         <span className="text-sm font-bold text-white">Exportar Todos os Pontos (CSV)</span>
                         <Download size={16} className="text-zinc-500 group-hover:text-white"/>
                     </button>
                     <button onClick={() => handleExportCSV(true)} disabled={selectedIds.size === 0} className="w-full flex items-center justify-between p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-white/5 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed">
                         <span className="text-sm font-bold text-white">Exportar Seleção (CSV)</span>
                         <div className="flex items-center gap-2">
                             <span className="text-xs text-zinc-500">{selectedIds.size} itens</span>
                             <Download size={16} className="text-zinc-500 group-hover:text-white"/>
                         </div>
                     </button>
                     <div className="h-px bg-white/5 my-2"></div>
                     <button className="w-full flex items-center justify-between p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-white/5 transition-colors group">
                         <span className="text-sm font-bold text-white">Exportar Projeto (DXF)</span>
                         <Box size={16} className="text-zinc-500 group-hover:text-cad-accent"/>
                     </button>
                     <button onClick={() => generateKML(false)} className="w-full flex items-center justify-between p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-white/5 transition-colors group">
                         <span className="text-sm font-bold text-white">Exportar Google Earth (KML/KMZ)</span>
                         <Globe size={16} className="text-zinc-500 group-hover:text-emerald-500"/>
                     </button>
                </div>
            </div>
            
            <div className="flex flex-col bg-zinc-900 border border-white/10 rounded-xl p-6 overflow-hidden">
                 <div className="flex items-center justify-between mb-4 text-zinc-300 font-bold border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3"><FileText size={20} className="text-cad-accent" /> Memorial Descritivo</div>
                    <button className="text-xs bg-cad-accent text-white px-3 py-1 rounded hover:bg-cad-accent/80">Copiar Texto</button>
                </div>
                <div className="flex-1 bg-zinc-950 rounded-lg p-4 font-mono text-xs text-zinc-400 overflow-y-auto border border-white/5">
                    {`MEMORIAL DESCRITIVO ANALÍTICO\n\nPROJETO: Levantamento Topográfico\nDATA: ${new Date().toLocaleDateString()}\n\nDESCRIÇÃO PERIMÉTRICA:\n\nInicia-se a descrição deste perímetro no vértice ${points[0]?.name}, de coordenadas N=${points[0]?.n.toFixed(3)}m e E=${points[0]?.e.toFixed(3)}m.\nDeste, segue confrontando com área remanescente, com os seguintes azimutes e distâncias:\n\n${points.slice(0, points.length-1).map((p, i) => {
                        const next = points[i+1];
                        const dist = Math.sqrt(Math.pow(next.n - p.n, 2) + Math.pow(next.e - p.e, 2)).toFixed(2);
                        return `Do vértice ${p.name} ao vértice ${next.name}, Azimute Calculado e distância de ${dist}m;`
                    }).join('\n')}\n\nFechando assim o polígono acima descrito com uma área superficial de calculada.`}
                </div>
            </div>
         </div>
      </div>
  );

  const renderDataTable = () => (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Table2 className="text-cad-accent" /> Banco de Dados
        </h2>
        <div className="flex gap-3">
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-sm font-medium transition-colors border border-white/5">
            <Upload size={16} /> Importar CSV
          </button>
          <button onClick={() => setShowNewPointModal(true)} className="flex items-center gap-2 px-4 py-2 bg-cad-accent text-white rounded-lg text-sm font-bold shadow-lg hover:brightness-110 transition-all">
            <Plus size={16} /> Novo Ponto
          </button>
        </div>
      </div>

      {/* Z Transformation Toolbar */}
      <div className="bg-zinc-900/80 border border-white/10 rounded-xl p-3 mb-4 flex items-center gap-4">
          <div className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2"><Settings size={14}/> Ajuste Global de Cota (Z)</div>
          <div className="h-4 w-px bg-white/10"></div>
          <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">Elevação Base:</label>
              <input type="number" value={zTransform.base} onChange={e => setZTransform({...zTransform, base: Number(e.target.value)})} className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white w-20 text-right" />
          </div>
          <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">Multiplicador:</label>
              <input type="number" value={zTransform.multiplier} onChange={e => setZTransform({...zTransform, multiplier: Number(e.target.value)})} className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white w-20 text-right" />
          </div>
          <button onClick={handleApplyZTransform} className="ml-auto px-3 py-1 bg-zinc-800 hover:bg-cad-accent hover:text-white text-xs rounded border border-white/10 transition-colors flex items-center gap-1">
             <RefreshCw size={12} /> Aplicar Transformação
          </button>
      </div>

      <div className="bg-zinc-900/50 border border-white/10 rounded-xl overflow-hidden flex flex-col flex-1 shadow-cad">
        <div className="p-4 border-b border-white/10 flex items-center gap-4 bg-zinc-900/80">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-cad-accent transition-colors"/>
          </div>
          <div className="text-xs text-zinc-500 font-mono">{filteredPoints.length} registros</div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="bg-zinc-900/90 text-xs font-bold text-zinc-500 uppercase sticky top-0 backdrop-blur-md z-10">
              <tr>
                <ResizableHeader label="#" width={colWidths.id} onResize={w => setColWidths({...colWidths, id: w})} />
                <ResizableHeader label="Nome" width={colWidths.name} onResize={w => setColWidths({...colWidths, name: w})} />
                <ResizableHeader label="Norte (Y)" width={colWidths.n} align="right" onResize={w => setColWidths({...colWidths, n: w})} />
                <ResizableHeader label="Leste (X)" width={colWidths.e} align="right" onResize={w => setColWidths({...colWidths, e: w})} />
                <ResizableHeader label="Cota (Z)" width={colWidths.z} align="right" onResize={w => setColWidths({...colWidths, z: w})} />
                <ResizableHeader label="Descrição" width={colWidths.desc} onResize={w => setColWidths({...colWidths, desc: w})} />
                <th className="p-4 border-b border-white/10 w-32 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm text-zinc-300 font-mono">
              {filteredPoints.map((point, idx) => (
                <tr key={point.id} className="hover:bg-white/5 transition-colors group">
                  <td className="p-4 truncate">{idx + 1}</td>
                  <td className="p-4 font-bold text-white truncate">{point.name}</td>
                  <td className="p-4 text-right text-cad-accent truncate">{point.n.toFixed(3)}</td>
                  <td className="p-4 text-right truncate">{point.e.toFixed(3)}</td>
                  <td className="p-4 text-right truncate group-hover:text-white transition-colors">
                      {/* Visual indication of potential transform */}
                      {point.z.toFixed(3)}
                  </td>
                  <td className="p-4 text-zinc-400 truncate">{point.desc}</td>
                  <td className="p-4 flex justify-center gap-2">
                    <button onClick={() => handleCopyCoords(point)} className="p-2 bg-zinc-800 text-zinc-400 hover:text-white rounded transition-colors"><Copy size={14} /></button>
                    <button onClick={() => handleViewOnMap(point)} className="p-2 bg-zinc-800 text-zinc-400 hover:text-cad-accent rounded transition-colors"><LocateFixed size={14} /></button>
                    <button className="p-2 text-zinc-600 hover:text-red-400 rounded transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderMap = () => {
    return (
      <div className="flex flex-col h-full animate-in fade-in duration-300">
        <div className="flex items-center justify-between mb-4 gap-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2 whitespace-nowrap">
               <MapIcon className="text-cad-accent" /> {is3DMode ? 'View3D Espacial' : 'SurveyMap 2D'}
            </h2>
             
             {/* Map Toolbar */}
             <div className="flex gap-2 items-center flex-1 overflow-x-auto p-1 scrollbar-hide">
                {!is3DMode && (
                  <>
                  {/* Tools Group */}
                  <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg p-1 px-2 mx-2">
                      <AutoCADTooltip title="Medir Distância" desc="Clique em 2 pontos">
                          <button 
                            onClick={() => { setMeasureMode(!measureMode); setAlignmentMode(false); setMeasurePoints([]); }}
                            className={`p-2 rounded-lg transition-all ${measureMode ? 'bg-cad-accent text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                              <Ruler size={18} />
                          </button>
                      </AutoCADTooltip>
                      <AutoCADTooltip title="Criar Eixo/Alinhamento" desc="Estaqueamento automático">
                          <button 
                            onClick={() => { setAlignmentMode(!alignmentMode); setMeasureMode(false); setAlignmentPoints([]); }}
                            className={`p-2 rounded-lg transition-all ${alignmentMode ? 'bg-cad-accent text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                          >
                              <Waypoints size={18} />
                          </button>
                      </AutoCADTooltip>
                  </div>

                  <div className="h-6 w-px bg-white/10 mx-2"></div>

                  <AutoCADTooltip title="Superfície TIN" desc="Malha Triangular">
                    <button 
                        onClick={() => setShowTIN(!showTIN)}
                        className={`p-2 rounded-lg transition-all ${showTIN ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50' : 'text-zinc-400 hover:bg-zinc-800'}`}
                    >
                        <Network size={18} />
                    </button>
                  </AutoCADTooltip>

                  <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1 border border-white/10">
                    <AutoCADTooltip title="Curvas de Nível" desc="Alternar isolinhas">
                        <button 
                            onClick={() => setShowContours(!showContours)}
                            className={`p-2 rounded-lg transition-all ${showContours ? 'bg-amber-500/20 text-amber-500 border border-amber-500/50' : 'text-zinc-400 hover:bg-zinc-800'}`}
                        >
                            <Mountain size={18} />
                        </button>
                    </AutoCADTooltip>
                    {showContours && (
                        <select 
                            value={contourInterval} 
                            onChange={(e) => setContourInterval(Number(e.target.value))}
                            className="bg-transparent text-[10px] text-zinc-300 font-bold border-l border-white/10 ml-1 pl-1 outline-none cursor-pointer hover:text-white"
                            title="Equidistância Vertical"
                        >
                            <option value="0.5">0.5m</option>
                            <option value="1">1.0m</option>
                            <option value="2">2.0m</option>
                            <option value="5">5.0m</option>
                        </select>
                    )}
                  </div>

                  <div className="h-6 w-px bg-white/10 mx-2"></div>
                  
                  {/* Export Selection CSV Button */}
                  <AutoCADTooltip title="Exportar CSV (Seleção)" desc="Salvar pontos selecionados em CSV">
                      <button 
                        onClick={() => handleExportCSV(true)} 
                        disabled={selectedIds.size === 0}
                        className={`p-2 rounded-lg border transition-all ${selectedIds.size > 0 ? 'bg-zinc-800 hover:bg-zinc-700 text-green-500 border-green-500/30' : 'bg-zinc-900 text-zinc-600 border-white/5 cursor-not-allowed'}`}
                      >
                         <FileDown size={18} />
                      </button>
                  </AutoCADTooltip>

                  <div className="h-6 w-px bg-white/10 mx-2"></div>

                  {/* Split Tool */}
                  <AutoCADTooltip title="Dividir Segmento" desc="Seccionar linhas e polígonos">
                      <button 
                        onClick={() => setIsSplitting(!isSplitting)}
                        className={`p-2 rounded-lg border transition-all ${isSplitting ? 'bg-cad-accent text-white border-cad-accent shadow-glow animate-pulse' : 'bg-zinc-800 text-zinc-400 border-white/5 hover:bg-zinc-700'}`}
                      >
                         <Scissors size={18} />
                      </button>
                  </AutoCADTooltip>

                  {/* Snap Settings */}
                  <div className="relative group">
                    <AutoCADTooltip title="Precisão e Snap" desc="Configurar atração magnética">
                        <button 
                            onClick={() => setSnapSettings(prev => ({...prev, enabled: !prev.enabled}))}
                            className={`p-2 rounded-lg border transition-all ${snapSettings.enabled ? 'bg-zinc-700 text-cad-accent border-cad-accent/50' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}
                        >
                            <Magnet size={18} />
                        </button>
                    </AutoCADTooltip>
                    <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-3 z-50 hidden group-hover:block">
                        {/* Snap Configs (Same as before) */}
                        <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Opções de Snap</div>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1 rounded">
                                <input type="checkbox" checked={snapSettings.enabled} onChange={e => setSnapSettings({...snapSettings, enabled: e.target.checked})} className="rounded bg-zinc-800 border-white/20"/>
                                <span className="text-xs text-white">Ativar Snap</span>
                            </label>
                            <div className="h-px bg-white/10"></div>
                            {/* ... Snap Checkboxes ... */}
                             <label className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1 rounded">
                                <Grid size={12} className={snapSettings.grid ? 'text-cad-accent' : 'text-zinc-600'} />
                                <input type="checkbox" checked={snapSettings.grid} onChange={e => setSnapSettings({...snapSettings, grid: e.target.checked})} className="rounded bg-zinc-800 border-white/20"/>
                                <span className="text-xs text-zinc-300">Grade ({snapSettings.gridInterval}m)</span>
                            </label>
                        </div>
                    </div>
                  </div>

                  <div className="h-6 w-px bg-white/10 mx-2"></div>

                  <div className="flex items-center gap-2 mr-4 bg-zinc-900 p-1 rounded-lg border border-white/10">
                    {showSaveViewDialog ? (
                      <div className="flex items-center animate-in slide-in-from-right-5">
                        <input autoFocus className="w-32 bg-zinc-800 border-none text-xs px-2 py-1 rounded text-white outline-none" placeholder="Nome..." value={viewNameInput} onChange={e => setViewNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveView()} />
                        <button onClick={handleSaveView} className="p-1 hover:text-green-400"><Check size={14}/></button>
                        <button onClick={() => setShowSaveViewDialog(false)} className="p-1 hover:text-red-400"><X size={14}/></button>
                      </div>
                    ) : (
                      <>
                        <AutoCADTooltip title="Salvar Vista" desc="Gravar posição e zoom atual">
                            <button onClick={() => setShowSaveViewDialog(true)} className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white"><Save size={14} /> Salvar</button>
                        </AutoCADTooltip>
                         {savedViews.length > 0 && (
                            <select onChange={(e) => handleRestoreView(e.target.value)} className="bg-zinc-800 text-xs py-1 px-2 rounded border-none outline-none text-zinc-300 w-24" defaultValue="">
                                <option value="" disabled>Vistas...</option>
                                {savedViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                         )}
                      </>
                    )}
                  </div>
                  </>
                )}
                
                <div className="relative group z-50">
                    <AutoCADTooltip title="Gerenciador de Camadas" desc="Alterar visibilidade e cores por descrição">
                        <button className="p-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 border border-white/5"><Layers size={18}/></button>
                    </AutoCADTooltip>
                    <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-white/10 rounded-lg shadow-xl p-3 z-50 hidden group-hover:block">
                        <div className="text-xs font-bold text-zinc-500 mb-2 px-1 uppercase flex justify-between items-center">
                            <span>Camadas & Cores</span>
                            <span className="text-[10px] text-zinc-600">Salvo automaticamente</span>
                        </div>
                        {(Object.entries(layerConfigs) as [string, LayerConfig][]).map(([desc, config]) => (
                            <div key={desc} className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded cursor-pointer transition-colors">
                                <span className="text-xs text-white font-medium truncate max-w-[100px]">{desc}</span>
                                <div className="flex items-center gap-3">
                                    <div className="relative w-5 h-5 rounded-full overflow-hidden border border-white/20">
                                        <input type="color" value={config.color} onChange={(e) => setLayerConfigs(prev => ({...prev, [desc]: {...prev[desc], color: e.target.value}}))} className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer p-0 border-0" />
                                    </div>
                                    <button onClick={() => setLayerConfigs(prev => ({...prev, [desc]: { ...prev[desc], visible: !config.visible }}))} className={`text-xs transition-colors ${config.visible ? 'text-cad-accent' : 'text-zinc-600'}`}>{config.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="h-6 w-px bg-white/10 mx-1"></div>
                <AutoCADTooltip title="Alternar Modo 2D/3D" desc="Mudar entre visualização em planta e perspectiva">
                    <button onClick={() => setIs3DMode(!is3DMode)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${is3DMode ? 'bg-cad-accent text-white shadow-lg' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>{is3DMode ? <Box size={16}/> : <MapIcon size={16}/>} {is3DMode ? '3D' : '2D'}</button>
                </AutoCADTooltip>
             </div>
        </div>
        <div className="flex-1 bg-zinc-950 border border-white/10 rounded-xl relative overflow-hidden flex items-center justify-center shadow-inner group cursor-none" onMouseLeave={() => setCursorTooltip({ ...cursorTooltip, text: '' })}>
           {is3DMode ? (
               <div className="absolute inset-0 cursor-default">
                    <Canvas camera={{ position: [50, 50, 50], fov: 45 }}>
                        <Scene3D points={points} layers={layerConfigs} />
                    </Canvas>
               </div>
           ) : (
               <>
                <div className="absolute inset-0 grid-cad-dark opacity-30 pointer-events-none"></div>
                
                {/* Visual Feedback for Split Candidate */}
                {isSplitting && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-cad-accent text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg shadow-cad-accent/30 pointer-events-none z-40 animate-bounce">
                        Selecione um segmento para dividir
                    </div>
                )}

                {/* Measure Mode Overlay */}
                {measureMode && measurePoints.length > 0 && (
                    <div className="absolute top-4 left-4 z-40">
                        <div className="bg-zinc-900/90 border border-white/10 p-3 rounded-xl shadow-2xl backdrop-blur">
                            <div className="text-xs font-bold text-zinc-500 uppercase mb-2">Ferramenta de Medição</div>
                            {measurePoints.map((p, i) => (
                                <div key={i} className="text-sm text-white mb-1">
                                    P{i+1}: N {p.n.toFixed(3)} E {p.e.toFixed(3)} Z {p.z.toFixed(3)}
                                </div>
                            ))}
                            {measurePoints.length === 2 && (() => {
                                const dist = calculateDistance3D(measurePoints[0], measurePoints[1]);
                                return (
                                    <div className="mt-3 pt-3 border-t border-white/10 text-xs space-y-1 font-mono">
                                        <div className="flex justify-between"><span className="text-zinc-400">Dist. Horizontal:</span> <span className="text-cad-accent">{dist.horizontal.toFixed(3)}m</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Dist. Inclinada:</span> <span className="text-white">{dist.slope.toFixed(3)}m</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Desnível (dZ):</span> <span className="text-white">{dist.deltaZ.toFixed(3)}m</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Declividade:</span> <span className="text-white">{dist.grade.toFixed(2)}%</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Azimute:</span> <span className="text-white">{calculateAzimuth(measurePoints[0], measurePoints[1]).toFixed(4)}°</span></div>
                                    </div>
                                )
                            })()}
                            <button onClick={() => setMeasurePoints([])} className="mt-2 w-full py-1 bg-zinc-800 hover:bg-zinc-700 text-xs rounded text-zinc-300">Limpar</button>
                        </div>
                    </div>
                )}

                {/* Selection Summary Overlay */}
                {selectedIds.size > 0 && !measureMode && !alignmentMode && (
                    <div className="absolute left-4 top-4 z-40 bg-zinc-900/90 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur animate-in slide-in-from-left-4 w-64">
                         <div className="flex justify-between items-center mb-3">
                             <div className="text-sm font-bold text-white flex items-center gap-2">
                                 <MousePointer2 size={16} className="text-cad-accent"/>
                                 Seleção ({selectedIds.size})
                             </div>
                             <button onClick={() => setSelectedIds(new Set())} className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white"><X size={14}/></button>
                         </div>
                         <div className="space-y-2 max-h-40 overflow-y-auto">
                            {Array.from(selectedIds).slice(0, 5).map(id => {
                                const p = points.find(pt => pt.id === id);
                                return p ? (
                                    <div key={id} className="flex justify-between text-xs bg-black/20 p-2 rounded border border-white/5">
                                        <span className="text-white font-mono">{p.name}</span>
                                        <span className="text-zinc-500">{p.desc}</span>
                                    </div>
                                ) : null;
                            })}
                            {selectedIds.size > 5 && <div className="text-xs text-center text-zinc-500 italic">...e mais {selectedIds.size - 5} itens</div>}
                         </div>
                         <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                             <button className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded text-zinc-300">Propriedades</button>
                             <button className="flex-1 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs rounded">Excluir</button>
                         </div>
                    </div>
                )}

                <div className={`absolute inset-0 overflow-hidden ${movingPointId ? 'cursor-grabbing' : (measureMode || alignmentMode) ? 'cursor-crosshair' : 'cursor-default'}`}
                    onMouseDown={(e) => handleMapMouseDown(e)}
                    onMouseUp={handleMapMouseUp} 
                    onMouseLeave={handleMapMouseUp} 
                    onMouseMove={handleMouseMove} 
                    onWheel={handleWheel}
                    onClick={(e) => handleMapClick(e)}
                >
                    <svg ref={svgRef} width="100%" height="100%" className="w-full h-full select-none">
                        <g transform={`translate(${mapPan.x}, ${mapPan.y}) scale(${mapZoom})`}>
                            
                            {/* TIN Surface Visualization */}
                            {showTIN && tinMesh.map((edge, i) => {
                                const p1 = normalizePoint(edge.p1);
                                const p2 = normalizePoint(edge.p2);
                                return (
                                    <line key={`tin-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#a855f7" strokeWidth={0.5 / mapZoom} opacity={0.3} />
                                )
                            })}

                            {/* Refined Contour Lines */}
                            {refinedContours.map((seg, i) => {
                                const isMaster = seg.z % (contourInterval * 5) === 0;
                                // Simple midpoint label for master contours
                                const midX = (seg.p1.x + seg.p2.x) / 2;
                                const midY = (seg.p1.y + seg.p2.y) / 2;
                                
                                return (
                                    <g key={`cont-${i}`}>
                                        <line 
                                            x1={seg.p1.x} y1={seg.p1.y} 
                                            x2={seg.p2.x} y2={seg.p2.y} 
                                            stroke={isMaster ? "#f59e0b" : "#fcd34d"} 
                                            strokeWidth={(isMaster ? 1.5 : 0.5) / mapZoom} 
                                            opacity={isMaster ? 0.8 : 0.4} 
                                        />
                                        {isMaster && (i % 3 === 0) && ( // Optimization: Don't label every segment, sparse labeling
                                            <text 
                                                x={midX} y={midY} 
                                                fontSize={8/mapZoom} 
                                                fill="#f59e0b" 
                                                textAnchor="middle" 
                                                alignmentBaseline="middle"
                                                className="font-mono bg-black"
                                            >
                                                {seg.z}
                                            </text>
                                        )}
                                    </g>
                                )
                            })}

                            {/* Lines connecting points (Polygon/Path) - Only visible if not TIN mode for cleaner look */}
                            {!showTIN && (
                                <path d={`M ${normalizePoint(points[0]).x} ${normalizePoint(points[0]).y} ` + points.map(p => { if (!layerConfigs[p.desc]?.visible) return ''; const {x,y} = normalizePoint(p); return `L ${x} ${y}`; }).join(' ')} className="stroke-white/10 stroke-1 fill-none pointer-events-none" />
                            )}
                            
                            {/* Measurement Line */}
                            {measurePoints.length === 2 && (() => {
                                const p1 = normalizePoint(measurePoints[0]);
                                const p2 = normalizePoint(measurePoints[1]);
                                return (
                                    <g>
                                        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#06b6d4" strokeWidth={2/mapZoom} strokeDasharray="5,5" />
                                        <circle cx={p1.x} cy={p1.y} r={3/mapZoom} fill="#06b6d4" />
                                        <circle cx={p2.x} cy={p2.y} r={3/mapZoom} fill="#06b6d4" />
                                    </g>
                                )
                            })()}

                            {/* Alignment (Eixo) */}
                            {alignmentPoints.length > 0 && (
                                <g>
                                    <path d={`M ${normalizePoint(alignmentPoints[0]).x} ${normalizePoint(alignmentPoints[0]).y} ` + alignmentPoints.map(p => `L ${normalizePoint(p).x} ${normalizePoint(p).y}`).join(' ')} stroke="#ef4444" strokeWidth={2/mapZoom} fill="none" />
                                    {alignmentPoints.map((p, i) => {
                                        const np = normalizePoint(p);
                                        return (
                                            <g key={i}>
                                                <line x1={np.x} y1={np.y-5/mapZoom} x2={np.x} y2={np.y+5/mapZoom} stroke="#ef4444" strokeWidth={1/mapZoom} />
                                                <text x={np.x} y={np.y+15/mapZoom} fontSize={10/mapZoom} fill="#ef4444" textAnchor="middle">{`${Math.floor(i*20/1000)}+${(i*20)%1000}`}</text>
                                            </g>
                                        )
                                    })}
                                </g>
                            )}

                            {/* Split Candidate Preview */}
                            {splitCandidate && (
                                <g className="pointer-events-none">
                                    <circle cx={normalizePoint(splitCandidate.point).x} cy={normalizePoint(splitCandidate.point).y} r={6 / mapZoom} className="fill-cad-accent animate-pulse" />
                                    <circle cx={normalizePoint(splitCandidate.point).x} cy={normalizePoint(splitCandidate.point).y} r={12 / mapZoom} className="fill-none stroke-cad-accent stroke-[2px] opacity-50" />
                                </g>
                            )}

                            {points.map((p) => {
                                if (!layerConfigs[p.desc]?.visible) return null;
                                const { x, y } = normalizePoint(p);
                                const isSnapped = snapPoint?.id === p.id;
                                const isSelected = selectedIds.has(p.id);
                                const isMoving = movingPointId === p.id;
                                const config = layerConfigs[p.desc];
                                const pointRadius = visualSettings.pointSize / mapZoom;
                                
                                return (
                                    <g key={p.id} onMouseDown={(e) => handleMapMouseDown(e, p)} className="cursor-pointer group/point">
                                        {/* Visual Feedback: Selection or Moving */}
                                        {(isSelected || isMoving) && (
                                            <>
                                                <circle cx={x} cy={y} r={(visualSettings.pointSize * (isMoving ? 5 : 3)) / mapZoom} fill={visualSettings.selectedColor} className={`opacity-20 ${isMoving ? 'animate-ping' : 'animate-pulse'}`} />
                                                <circle cx={x} cy={y} r={(visualSettings.pointSize * (isMoving ? 6 : 4)) / mapZoom} className="fill-none stroke-cad-accent stroke-[1px] opacity-50" />
                                            </>
                                        )}
                                        
                                        {/* Hit area */}
                                        <circle cx={x} cy={y} r={15 / mapZoom} className="fill-transparent" /> 
                                        
                                        {/* Snap Indicator */}
                                        {isSnapped && !isSplitting && !isMoving && <circle cx={x} cy={y} r={12 / mapZoom} stroke={visualSettings.snapColor} className="fill-none stroke-[2px] opacity-75" />}
                                        
                                        {/* Main Point */}
                                        <circle cx={x} cy={y} r={pointRadius} fill={isSelected ? visualSettings.selectedColor : (config?.color || '#06b6d4')} stroke={isSelected ? visualSettings.selectedColor : '#18181b'} strokeWidth={2 / mapZoom} className="transition-all duration-300 group-hover/point:fill-yellow-400" />
                                        
                                        {/* Label */}
                                        <text x={x + (pointRadius + 4)} y={y - (pointRadius + 4)} fontSize={12 / mapZoom} className={`font-mono font-bold select-none pointer-events-none ${isSelected || isMoving ? 'fill-white text-shadow-glow' : 'fill-zinc-400'}`}>{p.name}</text>
                                        {/* Z Label if needed */}
                                        <text x={x + (pointRadius + 4)} y={y + (pointRadius + 8)} fontSize={8 / mapZoom} className="font-mono text-zinc-600 select-none pointer-events-none">{p.z.toFixed(2)}</text>
                                    </g>
                                )
                            })}

                            {/* Midpoint Snap Indicator */}
                            {snapMidpoint && (
                                <g className="pointer-events-none">
                                    <polygon points={`${snapMidpoint.point.x},${snapMidpoint.point.y - 10/mapZoom} ${snapMidpoint.point.x - 8/mapZoom},${snapMidpoint.point.y + 6/mapZoom} ${snapMidpoint.point.x + 8/mapZoom},${snapMidpoint.point.y + 6/mapZoom}`} fill={visualSettings.snapColor} />
                                    <text x={snapMidpoint.point.x + 10/mapZoom} y={snapMidpoint.point.y} fontSize={10/mapZoom} fill={visualSettings.snapColor} className="font-mono">{snapMidpoint.label}</text>
                                </g>
                            )}

                             {/* Grid Snap Indicator */}
                            {snapGrid && (
                                <g className="pointer-events-none">
                                     <rect x={snapGrid.point.x - 5/mapZoom} y={snapGrid.point.y - 5/mapZoom} width={10/mapZoom} height={10/mapZoom} fill="none" stroke={visualSettings.snapColor} strokeWidth={1} />
                                     <line x1={snapGrid.point.x - 10/mapZoom} y1={snapGrid.point.y} x2={snapGrid.point.x + 10/mapZoom} y2={snapGrid.point.y} stroke={visualSettings.snapColor} strokeWidth={1/mapZoom} />
                                     <line x1={snapGrid.point.x} y1={snapGrid.point.y - 10/mapZoom} x2={snapGrid.point.x} y2={snapGrid.point.y + 10/mapZoom} stroke={visualSettings.snapColor} strokeWidth={1/mapZoom} />
                                </g>
                            )}

                        </g>
                    </svg>
                </div>
                {/* Floating Cursor Tooltip */}
                {cursorTooltip.text && (
                    <div 
                        className="fixed z-50 pointer-events-none bg-zinc-900/90 text-white text-[10px] px-2 py-1 rounded shadow-lg backdrop-blur font-bold border border-white/20 transform -translate-x-1/2 -translate-y-full mt-[-15px]"
                        style={{ left: cursorTooltip.x, top: cursorTooltip.y }}
                    >
                        {cursorTooltip.text}
                    </div>
                )}

                <div className="absolute bottom-4 right-4 bg-zinc-900/90 p-4 rounded-lg border border-white/10 text-xs text-zinc-400 font-mono shadow-xl backdrop-blur pointer-events-none select-none">
                    <div className="font-bold text-white mb-1">Propriedades</div>
                    <div>Zoom: {(mapZoom * 100).toFixed(0)}%</div>
                    <div>Pan: X{Math.round(mapPan.x)} Y{Math.round(mapPan.y)}</div>
                    <div className="h-px bg-white/10 my-2"></div>
                    <div className="flex items-center gap-2">
                        {snapPoint ? (
                             <>
                                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                                <span className="text-yellow-400 font-bold">SNAP: {snapPoint.name}</span>
                             </>
                        ) : snapMidpoint ? (
                             <>
                                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                                <span className="text-yellow-400 font-bold">SNAP: {snapMidpoint.label}</span>
                             </>
                        ) : snapGrid ? (
                             <>
                                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                                <span className="text-yellow-400 font-bold">SNAP: GRADE</span>
                             </>
                        ) : (
                             <>
                                <div className="w-2 h-2 rounded-full bg-zinc-700"></div>
                                <span className="text-zinc-600">Sem alvo</span>
                             </>
                        )}
                    </div>
                </div>
               </>
           )}
        </div>
      </div>
    );
  };

  const renderTools = () => (
      <div className="flex flex-col h-full animate-in fade-in duration-300">
         <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
               <Calculator className="text-cad-accent" /> Ferramentas de Cálculo
            </h2>
            {activeTool && (
               <button onClick={() => setActiveTool(null)} className="text-sm text-zinc-400 hover:text-white flex items-center gap-1 border border-white/10 px-3 py-1.5 rounded hover:bg-white/5 transition-colors">
                  <RefreshCw size={14}/> Voltar
               </button>
            )}
         </div>
         {!activeTool ? (
            <div className="grid grid-cols-4 gap-4">
                 {[
                     { id: 'geodesia', label: 'Conversor Geodésico', icon: Globe, desc: 'UTM x Lat/Long' },
                     { id: 'volume', label: 'Cálculo de Volume', icon: Component, desc: 'Corte e Aterro' },
                     { id: 'perfil', label: 'Perfil Longitudinal', icon: TrendingUp, desc: 'Visualização de Greide' },
                     { id: 'memorial', label: 'Memorial Descritivo', icon: FileText, desc: 'Gerar Documento' },
                 ].map((tool) => (
                     <button key={tool.id} onClick={() => setActiveTool(tool.id as ToolType)} className="flex flex-col items-center justify-center p-6 bg-zinc-900 border border-white/10 rounded-xl hover:bg-zinc-800 hover:border-cad-accent transition-all group">
                        <div className="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <tool.icon size={24} className="text-cad-accent" />
                        </div>
                        <span className="font-bold text-white mb-1">{tool.label}</span>
                        <span className="text-xs text-zinc-500">{tool.desc}</span>
                     </button>
                 ))}
                 {[
                     { id: 'reconstituicao', label: 'Reconstituição', icon: History },
                     { id: 'incra', label: 'Padrão INCRA', icon: FileOutput },
                     { id: 'modelagem', label: 'Modelagem 3D', icon: Box },
                  ].map((tool) => (
                     <button key={tool.id} onClick={() => setActiveTool(tool.id as ToolType)} className="flex flex-col items-center justify-center p-6 bg-zinc-900/50 border border-white/5 rounded-xl hover:bg-zinc-900 hover:border-white/20 transition-all group opacity-60 hover:opacity-100">
                        <div className="w-12 h-12 bg-black/30 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <tool.icon size={24} className="text-zinc-600 group-hover:text-zinc-400" />
                        </div>
                        <span className="font-bold text-zinc-400 mb-1">{tool.label}</span>
                        <span className="text-xs text-zinc-600">Em breve</span>
                     </button>
                 ))}
            </div>
         ) : (
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 flex-1 overflow-y-auto relative">
                 {activeTool === 'geodesia' && <GeodesiaTool points={points} />}
                 {activeTool === 'volume' && <VolumeTool points={points} />}
                 {activeTool === 'perfil' && <PerfilTool points={points} />}
                 {activeTool === 'memorial' && <MemorialTool points={points} />}
                 {!['geodesia', 'volume', 'perfil', 'memorial'].includes(activeTool) && (
                     <div className="flex flex-col items-center justify-center h-full text-zinc-500">
                         <AlertCircle size={48} className="mb-4 opacity-50"/>
                         <p>Ferramenta em desenvolvimento.</p>
                     </div>
                 )}
            </div>
         )}
      </div>
  );

  return (
    <div className="flex h-screen w-full bg-[#09090b] text-zinc-100 overflow-hidden font-sans">
      <div className="w-64 bg-[#18181b] border-r border-white/5 flex flex-col shrink-0 z-30">
        <Logo />
        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
           <button onClick={() => setActiveTab('dados')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dados' ? 'bg-cad-accent text-white shadow-lg shadow-cad-accent/20' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><Table2 size={18} /> Dados Brutos</button>
           <button onClick={() => setActiveTab('mapa')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'mapa' ? 'bg-cad-accent text-white shadow-lg shadow-cad-accent/20' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><MapIcon size={18} /> Mapa Visual</button>
           <button onClick={() => setActiveTab('ferramentas')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'ferramentas' ? 'bg-cad-accent text-white shadow-lg shadow-cad-accent/20' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><Calculator size={18} /> Ferramentas</button>
           <button onClick={() => setActiveTab('relatorios')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'relatorios' ? 'bg-cad-accent text-white shadow-lg shadow-cad-accent/20' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><FileText size={18} /> Relatórios</button>
        </div>
        <div className="p-4 border-t border-white/5 space-y-2">
           <button onClick={() => setShowVersionModal(true)} className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm"><History size={18} /> Versões / Snapshots</button>
           <button onClick={() => setShowSettingsModal(true)} className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm"><Settings size={18} /> Configurações</button>
           <div className="mt-4 flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 ring-2 ring-black"></div>
              <div className="flex flex-col"><span className="text-xs font-bold text-white">Eng. Civil</span><span className="text-[10px] text-zinc-500">Versão 3.0 Pro</span></div>
           </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative">
         <div className="absolute inset-0 grid-cad-dark opacity-50 pointer-events-none"></div>
         <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-[#09090b]/80 backdrop-blur z-20">
            <div className="flex items-center gap-4 text-sm text-zinc-500"><span className="text-white font-medium">Projeto Ativo:</span> Levantamento Topográfico - Fazenda Sta. Maria</div>
            <div className="flex items-center gap-4"><span className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 text-emerald-500 text-xs rounded border border-emerald-500/20 font-medium"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Online</span></div>
         </header>
         <main className="flex-1 p-8 overflow-hidden z-10 relative">
            {activeTab === 'dados' && renderDataTable()}
            {activeTab === 'mapa' && renderMap()}
            {activeTab === 'ferramentas' && renderTools()}
            {activeTab === 'relatorios' && renderReports()}
            {showImportModal && <CSVImportModal onClose={() => setShowImportModal(false)} onImport={(pts) => setPoints([...points, ...pts])} />}
            {showNewPointModal && <NewPointModal onClose={() => setShowNewPointModal(false)} onSave={(p) => setPoints([...points, p])} />}
            {showSettingsModal && <SettingsModal settings={visualSettings} onSave={updateVisualSettings} onClose={() => setShowSettingsModal(false)} layerConfigs={layerConfigs} setLayerConfigs={setLayerConfigs} />}
            {showVersionModal && <VersionControlModal onClose={() => setShowVersionModal(false)} currentPoints={points} onLoad={setPoints} />}
         </main>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);