import { newId } from './ids';

export type NodeType = 'widget' | 'group';
export type TextAlign = 'left' | 'center' | 'right';

export interface NodeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: TextAlign;
  textColor: string;
  textOpacity: number;
  bgColor: string;
  bgOpacity: number;
  bgGradient: { enabled: boolean; color2: string; angle: number };
  padding: number;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  radius: number;
  glowEnabled: boolean;
  glowColor: string;
  glowSize: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOpacity: number;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  animate: boolean;
  animationSpeed: number;
}

export interface WidgetInstance {
  kind: string;
  version: number;
  props: Record<string, unknown>;
}

export interface NodeOutput {
  padding: number;
}

export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  children: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  style: NodeStyle;
  widget: WidgetInstance | null;
  output: NodeOutput;
}

export interface Scene {
  id: string;
  name: string;
  width: number;
  height: number;
  nodes: Record<string, SceneNode>;
  rootIds: string[];
}

export interface AssetRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface ProjectSettings {
  reduceMotion: boolean;
}

export interface ProjectDoc {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
  assets: AssetRef[];
  settings: ProjectSettings;
}

export interface ProjectFile {
  format: 'neonstage-project';
  fileVersion: 1;
  draft: ProjectDoc;
  live: ProjectDoc;
  programSceneId: string;
  liveEdit: boolean;
}

export const CURRENT_SCHEMA_VERSION = 1;

export interface CanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: '1080p', label: '1080p (1920 x 1080)', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p (2560 x 1440)', width: 2560, height: 1440 },
  { id: '720p', label: '720p (1280 x 720)', width: 1280, height: 720 },
  { id: '2160p', label: '2160p (3840 x 2160)', width: 3840, height: 2160 },
  { id: 'portrait-9-16', label: 'Portrait 9:16 (1080 x 1920)', width: 1080, height: 1920 },
  { id: 'portrait-720', label: 'Portrait 9:16 (720 x 1280)', width: 720, height: 1280 },
  { id: 'portrait-4-5', label: 'Portrait 4:5 (1080 x 1350)', width: 1080, height: 1350 },
  { id: 'square', label: 'Square (1080 x 1080)', width: 1080, height: 1080 },
];

export function defaultStyle(): NodeStyle {
  return {
    fontFamily: '"Bahnschrift", "Segoe UI", sans-serif',
    fontSize: 32,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    textColor: '#ffffff',
    textOpacity: 1,
    bgColor: '#120a24',
    bgOpacity: 0,
    bgGradient: { enabled: false, color2: '#2a0f4a', angle: 135 },
    padding: 0,
    borderWidth: 0,
    borderColor: '#ff3fd2',
    borderOpacity: 1,
    radius: 0,
    glowEnabled: false,
    glowColor: '#ff3fd2',
    glowSize: 8,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowX: 0,
    shadowY: 4,
    shadowBlur: 12,
    animate: true,
    animationSpeed: 1,
  };
}

export function createScene(name: string, width: number, height: number): Scene {
  return {
    id: newId('sc'),
    name,
    width,
    height,
    nodes: {},
    rootIds: [],
  };
}

export function createEmptyProject(name: string): ProjectDoc {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    scenes: [createScene('Main', 1920, 1080)],
    assets: [],
    settings: { reduceMotion: false },
  };
}
