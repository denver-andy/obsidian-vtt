import type { MapInstance, MeasureDiagonal } from './map-data';

const ZOOM_FACTOR = 1.12;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;

const PAN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Rotation drag: pixels of horizontal movement per radian, and snap increment.
const ROTATE_PIXELS_PER_RAD = 120;
const ROTATE_SNAP_RAD = 15 * Math.PI / 180;

// Resize handle: drawn circle radius in CSS pixels (also used as hit-test radius).
const HANDLE_CSS_RADIUS = 8;

export interface AssetDropData {
	assetPath: string;
	resourceUrl: string;
	category: string;
	worldX: number;
	worldY: number;
}

export interface MapLayers {
	backgrounds: MapInstance[];
	tiles: MapInstance[];
	prefabs: MapInstance[];
	objects: MapInstance[];
	tokens: MapInstance[];
}

export interface ScreenBounds {
	/** CSS-pixel coordinates relative to the canvas top-left. */
	x: number;
	y: number;
	w: number;
	h: number;
	instanceId: string;
	layerId: keyof MapLayers;
	/** True when two or more instances are selected. */
	isMulti?: boolean;
}

export interface MapConfig {
	cellSize: number;
	panSpeed: number;
	gridColor: string;
	showGrid: boolean;
	getResourcePath: (path: string) => string;
	onAssetDrop?: (data: AssetDropData) => void;
	onSelect?: (instanceId: string | null) => void;
	/** Fired after every draw with the screen bounds of the current selection
	 *  (single or multi), or null when the selection is empty. */
	onAfterDraw?: (bounds: ScreenBounds | null) => void;
	/** Fired when the measurement tool deactivates itself (Escape or right-click). */
	onMeasureDeactivate?: () => void;
	/** Fired when the user presses Ctrl/Cmd+C with a single asset selected. */
	onCopySelection?: (instanceId: string, layerId: keyof MapLayers) => void;
	/** Fired on Ctrl/Cmd+click — toggle the clicked instance in/out of the selection. */
	onMultiToggle?: (instanceId: string) => void;
	/** Fired when the user presses Ctrl/Cmd+V, with the snapped world position
	 *  at the center of the viewport as the suggested paste location. */
	onPasteRequest?: (worldX: number, worldY: number) => void;
}

export class MapRenderer {
	readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;

	private panX = 0;
	private panY = 0;
	private zoom = 1;
	private dpr = 1;

	private cellSize: number;
	private panSpeed: number;
	private gridColor: string;
	private showGrid: boolean;
	private readonly getResourcePath: (path: string) => string;
	private readonly onAssetDrop?: (data: AssetDropData) => void;

	private layers: MapLayers = { backgrounds: [], tiles: [], prefabs: [], objects: [], tokens: [] };
	private selectedIds = new Set<string>();
	private readonly imageCache = new Map<string, HTMLImageElement | null>();

	private activeMode: 'move' | 'rotate' | 'resize' = 'move';

	private measureActive = false;
	private measureUnits = 5;
	private measureUnitLabel = 'ft';
	private measureDiagonal: MeasureDiagonal = 'exact';
	private measureStart: { gx: number; gy: number } | null = null;
	private measureCurrent: { gx: number; gy: number } | null = null;

	private dragInst: MapInstance | null = null;
	private dragInstances: MapInstance[] = [];
	private dragOffsetWorldX = 0;
	private dragOffsetWorldY = 0;
	private dragRotateStartX = 0;
	private dragStartRotations = new Map<string, number>();
	private dragResizeOrigRotation = 0;
	private dragMoved = false;

	private panDragActive = false;
	private panDragLastX = 0;
	private panDragLastY = 0;
	private panDragMoved = false;



	private readonly onSelect?: (instanceId: string | null) => void;
	private readonly onAfterDraw?: (bounds: ScreenBounds | null) => void;
	private readonly onMeasureDeactivate?: () => void;
	private readonly onCopySelection?: (instanceId: string, layerId: keyof MapLayers) => void;
	private readonly onPasteRequest?: (worldX: number, worldY: number) => void;
	private readonly onMultiToggle?: (instanceId: string) => void;

	// Offset of the canvas's top-left corner within its positioning container.
	// Non-zero when Obsidian's layout pushes the canvas away from (0, 0).
	private canvasOffsetX = 0;
	private canvasOffsetY = 0;
	private readonly container: HTMLElement;

	private readonly resizeObserver: ResizeObserver;
	private readonly boundWheel: (e: WheelEvent) => void;
	private readonly boundKeyDown: (e: KeyboardEvent) => void;
	private readonly boundDragOver: (e: DragEvent) => void;
	private readonly boundDrop: (e: DragEvent) => void;
	private readonly boundClick: (e: MouseEvent) => void;
	private readonly boundMouseDown: (e: MouseEvent) => void;
	private readonly boundMouseMove: (e: MouseEvent) => void;
	private readonly boundMouseUp: (e: MouseEvent) => void;
	private readonly boundContextMenu: (e: MouseEvent) => void;

	constructor(container: HTMLElement, config: MapConfig) {
		this.container = container;
		this.cellSize = config.cellSize;
		this.panSpeed = config.panSpeed;
		this.gridColor = config.gridColor;
		this.showGrid = config.showGrid;
		this.getResourcePath = config.getResourcePath;
		this.onAssetDrop = config.onAssetDrop;
		this.onSelect = config.onSelect;
		this.onAfterDraw = config.onAfterDraw;
		this.onMeasureDeactivate = config.onMeasureDeactivate;
		this.onCopySelection = config.onCopySelection;
		this.onPasteRequest = config.onPasteRequest;
		this.onMultiToggle = config.onMultiToggle;

		this.canvas = document.createElement('canvas');
		this.canvas.classList.add('vtt-canvas');
		this.canvas.tabIndex = 0;
		container.appendChild(this.canvas);

		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');
		this.ctx = ctx;

		this.boundWheel    = this.onWheel.bind(this);
		this.boundKeyDown  = this.onKeyDown.bind(this);
		this.boundDragOver = this.onDragOver.bind(this);
		this.boundDrop     = this.onDrop.bind(this);
		this.boundClick    = this.onClick.bind(this);
		this.boundMouseDown    = this.onMouseDown.bind(this);
		this.boundMouseMove    = this.onMouseMove.bind(this);
		this.boundMouseUp      = this.onMouseUp.bind(this);
		this.boundContextMenu  = this.onContextMenu.bind(this);

		this.canvas.addEventListener('wheel',     this.boundWheel,    { passive: false });
		this.canvas.addEventListener('keydown',   this.boundKeyDown);
		this.canvas.addEventListener('dragover',  this.boundDragOver);
		this.canvas.addEventListener('drop',      this.boundDrop);
		this.canvas.addEventListener('click',       this.boundClick);
		this.canvas.addEventListener('mousedown',   this.boundMouseDown);
		this.canvas.addEventListener('contextmenu', this.boundContextMenu);
		window.addEventListener('mousemove', this.boundMouseMove);
		window.addEventListener('mouseup',   this.boundMouseUp);

		this.resizeObserver = new ResizeObserver(() => this.onResize());
		this.resizeObserver.observe(container);

		this.onResize();
	}

	destroy() {
		this.resizeObserver.disconnect();
		this.canvas.removeEventListener('wheel',     this.boundWheel);
		this.canvas.removeEventListener('keydown',   this.boundKeyDown);
		this.canvas.removeEventListener('dragover',  this.boundDragOver);
		this.canvas.removeEventListener('drop',      this.boundDrop);
		this.canvas.removeEventListener('click',       this.boundClick);
		this.canvas.removeEventListener('mousedown',   this.boundMouseDown);
		this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
		window.removeEventListener('mousemove', this.boundMouseMove);
		window.removeEventListener('mouseup',   this.boundMouseUp);
		this.canvas.remove();
	}

	setCellSize(value: number) {
		this.cellSize = value;
		this.draw();
	}

	setPanSpeed(value: number) {
		this.panSpeed = value;
	}

	setGridColor(value: string) {
		this.gridColor = value;
		this.draw();
	}

	setShowGrid(value: boolean) {
		this.showGrid = value;
		this.draw();
	}

	setLayers(layers: MapLayers) {
		this.layers = layers;
		this.draw();
	}

	setSelectedIds(ids: Set<string>) {
		this.selectedIds = new Set(ids);
		this.draw();
	}

	setActiveMode(mode: 'move' | 'rotate' | 'resize') {
		this.activeMode = mode;
	}

	setMeasureToolActive(active: boolean) {
		this.measureActive = active;
		if (!active) {
			this.measureStart = null;
			this.measureCurrent = null;
		}
		this.canvas.style.cursor = active ? 'crosshair' : '';
		this.draw();
	}

	setMeasureConfig(units: number, unitLabel: string, diagonal: MeasureDiagonal) {
		this.measureUnits = units;
		this.measureUnitLabel = unitLabel;
		this.measureDiagonal = diagonal;
		if (this.measureActive && this.measureStart !== null) this.draw();
	}

	private onResize() {
		this.dpr = window.devicePixelRatio || 1;
		const canvasRect = this.canvas.getBoundingClientRect();
		const { width, height } = canvasRect;
		if (width === 0 || height === 0) return;

		// Track where the canvas sits inside the container so ScreenBounds
		// coordinates can be used directly as absolute CSS positions.
		const containerRect = this.container.getBoundingClientRect();
		this.canvasOffsetX = canvasRect.left - containerRect.left;
		this.canvasOffsetY = canvasRect.top  - containerRect.top;

		this.canvas.width = width * this.dpr;
		this.canvas.height = height * this.dpr;
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.draw();
	}

	private cssW() { return this.canvas.width / this.dpr; }
	private cssH() { return this.canvas.height / this.dpr; }

	getCameraState(): { panX: number; panY: number; zoom: number } {
		return { panX: this.panX, panY: this.panY, zoom: this.zoom };
	}

	setCameraState(state: { panX: number; panY: number; zoom: number }) {
		this.panX = state.panX;
		this.panY = state.panY;
		this.zoom = state.zoom;
		this.draw();
	}

	resetCamera() {
		this.panX = 0;
		this.panY = 0;
		this.zoom = 1;
		this.draw();
	}

	zoomIn() {
		this.applyZoom(ZOOM_FACTOR, this.cssW() / 2, this.cssH() / 2);
	}

	zoomOut() {
		this.applyZoom(1 / ZOOM_FACTOR, this.cssW() / 2, this.cssH() / 2);
	}

	private applyZoom(factor: number, pivotX: number, pivotY: number) {
		const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
		this.panX = pivotX - (pivotX - this.panX) * (newZoom / this.zoom);
		this.panY = pivotY - (pivotY - this.panY) * (newZoom / this.zoom);
		this.zoom = newZoom;
		this.draw();
	}

	private onClick(e: MouseEvent) {
		// Suppress click if the mousedown turned into a real drag.
		if (this.dragMoved) { this.dragMoved = false; return; }
		this.canvas.focus();

		if (this.measureActive) {
			const rect = this.canvas.getBoundingClientRect();
			const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
			const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;
			this.measureStart = {
				gx: Math.floor(worldX / this.cellSize),
				gy: Math.floor(worldY / this.cellSize),
			};
			this.measureCurrent = null;
			this.draw();
			return;
		}

		const rect = this.canvas.getBoundingClientRect();
		const inst = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);

		if (e.ctrlKey || e.metaKey) {
			if (inst) this.onMultiToggle?.(inst.id);
			return;
		}

		if (!this.onSelect) return;
		this.onSelect(inst?.id ?? null);
	}

	private onMouseDown(e: MouseEvent) {
		if (e.button === 2) {
			if (this.measureActive) return; // let contextmenu deactivate the tool
			this.panDragActive = true;
			this.panDragLastX = e.clientX;
			this.panDragLastY = e.clientY;
			this.panDragMoved = false;
			this.canvas.style.cursor = 'grabbing';
			e.preventDefault();
			return;
		}
		if (this.measureActive) return;
		if (e.button !== 0 || this.selectedIds.size === 0) return;
		if (this.activeMode !== 'move' && this.activeMode !== 'rotate' && this.activeMode !== 'resize') return;

		const rect = this.canvas.getBoundingClientRect();
		const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
		const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;

		this.dragMoved = false;

		if (this.activeMode === 'resize') {
			// Resize is single-selection only.
			if (this.selectedIds.size !== 1) return;
			const [instanceId] = this.selectedIds;
			let inst: MapInstance | undefined;
			let layerId: keyof MapLayers | undefined;
			for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
				const found = this.layers[lid].find(i => i.id === instanceId);
				if (found) { inst = found; layerId = lid; break; }
			}
			if (!inst || !layerId || inst.hidden) return;
			const defaultLocked = layerId === 'backgrounds' || layerId === 'prefabs';
			if (inst.locked ?? defaultLocked) return;
			if (!this.isOnResizeHandle(inst, worldX, worldY)) return;
			this.dragInst = inst;
			this.dragInstances = [inst];
			this.dragResizeOrigRotation = inst.rotation;
			inst.rotation = 0;
			this.canvas.style.cursor = 'nwse-resize';
			e.preventDefault();
			return;
		}

		// Move and rotate support multi-select.
		// Find the topmost selected, unlocked, non-hidden instance under the cursor.
		let clickedInst: MapInstance | undefined;
		for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
			const defaultLocked = lid === 'backgrounds' || lid === 'prefabs';
			for (let i = this.layers[lid].length - 1; i >= 0; i--) {
				const inst = this.layers[lid][i]!;
				if (!this.selectedIds.has(inst.id)) continue;
				if (inst.hidden || (inst.locked ?? defaultLocked)) continue;
				if (!this.hitTestInstance(inst, worldX, worldY)) continue;
				clickedInst = inst;
				break;
			}
			if (clickedInst) break;
		}
		if (!clickedInst) return;

		this.dragInst = clickedInst;

		// Collect every selected, unlocked, non-hidden instance for the drag.
		this.dragInstances = [];
		for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
			const defaultLocked = lid === 'backgrounds' || lid === 'prefabs';
			for (const inst of this.layers[lid]) {
				if (this.selectedIds.has(inst.id) && !inst.hidden && !(inst.locked ?? defaultLocked)) {
					this.dragInstances.push(inst);
				}
			}
		}

		if (this.activeMode === 'move') {
			this.dragOffsetWorldX = worldX - clickedInst.x;
			this.dragOffsetWorldY = worldY - clickedInst.y;
			this.canvas.style.cursor = 'grabbing';
		} else {
			// rotate
			this.dragRotateStartX = e.clientX;
			this.dragStartRotations.clear();
			for (const inst of this.dragInstances) {
				this.dragStartRotations.set(inst.id, inst.rotation);
			}
			this.canvas.style.cursor = 'ew-resize';
		}
		e.preventDefault();
	}

	private onMouseMove(e: MouseEvent) {
		if (this.panDragActive) {
			const dx = e.clientX - this.panDragLastX;
			const dy = e.clientY - this.panDragLastY;
			this.panDragLastX = e.clientX;
			this.panDragLastY = e.clientY;
			if (dx !== 0 || dy !== 0) {
				this.panX += dx;
				this.panY += dy;
				this.panDragMoved = true;
				this.draw();
			}
			return;
		}

		if (this.measureActive && this.measureStart !== null) {
			const rect = this.canvas.getBoundingClientRect();
			const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
			const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;
			const gx = Math.floor(worldX / this.cellSize);
			const gy = Math.floor(worldY / this.cellSize);
			if (this.measureCurrent?.gx !== gx || this.measureCurrent?.gy !== gy) {
				this.measureCurrent = { gx, gy };
				this.draw();
			}
			return;
		}

		if (this.dragInst) {
			if (this.activeMode === 'move') {
				const rect = this.canvas.getBoundingClientRect();
				const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
				const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;
				const snappedX = Math.round((worldX - this.dragOffsetWorldX) / this.cellSize) * this.cellSize;
				const snappedY = Math.round((worldY - this.dragOffsetWorldY) / this.cellSize) * this.cellSize;
				if (snappedX !== this.dragInst.x || snappedY !== this.dragInst.y) {
					const dx = snappedX - this.dragInst.x;
					const dy = snappedY - this.dragInst.y;
					for (const inst of this.dragInstances) {
						inst.x += dx;
						inst.y += dy;
					}
					this.dragMoved = true;
					this.draw();
				}
			} else if (this.activeMode === 'rotate') {
				const deltaRad = (e.clientX - this.dragRotateStartX) / ROTATE_PIXELS_PER_RAD;
				let changed = false;
				for (const inst of this.dragInstances) {
					const startRot = this.dragStartRotations.get(inst.id) ?? 0;
					const snappedRot = Math.round((startRot + deltaRad) / ROTATE_SNAP_RAD) * ROTATE_SNAP_RAD;
					if (snappedRot !== inst.rotation) {
						inst.rotation = snappedRot;
						changed = true;
					}
				}
				if (changed) { this.dragMoved = true; this.draw(); }
			} else if (this.activeMode === 'resize') {
				const rect = this.canvas.getBoundingClientRect();
				const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
				const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;
				const newW = Math.max(this.cellSize, Math.round((worldX - this.dragInst.x) / this.cellSize) * this.cellSize);
				const newH = Math.max(this.cellSize, Math.round((worldY - this.dragInst.y) / this.cellSize) * this.cellSize);
				if (newW !== this.dragInst.width || newH !== this.dragInst.height) {
					this.dragInst.width  = newW;
					this.dragInst.height = newH;
					this.dragMoved = true;
					this.draw();
				}
			}
			return;
		}

		// Update hover cursor when in an interactive mode and over a draggable selected instance.
		if (e.target !== this.canvas || this.selectedIds.size === 0) return;
		const rect = this.canvas.getBoundingClientRect();
		const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
		const worldY = (e.clientY - rect.top  - this.panY) / this.zoom;

		if (this.activeMode === 'resize') {
			// Resize is single-selection only.
			if (this.selectedIds.size !== 1) { this.canvas.style.cursor = ''; return; }
			const [instanceId] = this.selectedIds;
			for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
				const inst = this.layers[lid].find(i => i.id === instanceId);
				if (!inst || inst.hidden) continue;
				const defaultLocked = lid === 'backgrounds' || lid === 'prefabs';
				if (inst.locked ?? defaultLocked) { this.canvas.style.cursor = ''; return; }
				this.canvas.style.cursor = this.isOnResizeHandle(inst, worldX, worldY) ? 'nwse-resize' : '';
				return;
			}
			return;
		}

		// Move/rotate: show cursor when hovering any selected, unlocked, non-hidden instance.
		const hoverCursor = this.activeMode === 'move' ? 'grab' : 'ew-resize';
		for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
			const defaultLocked = lid === 'backgrounds' || lid === 'prefabs';
			for (let i = this.layers[lid].length - 1; i >= 0; i--) {
				const inst = this.layers[lid][i]!;
				if (!this.selectedIds.has(inst.id) || inst.hidden || (inst.locked ?? defaultLocked)) continue;
				if (this.hitTestInstance(inst, worldX, worldY)) {
					this.canvas.style.cursor = hoverCursor;
					return;
				}
			}
		}
		this.canvas.style.cursor = '';
	}

	private onMouseUp(e: MouseEvent) {
		if (e.button === 2 && this.panDragActive) {
			this.panDragActive = false;
			this.canvas.style.cursor = '';
			return;
		}
		if (e.button !== 0 || !this.dragInst) return;
		if (this.activeMode === 'resize') {
			this.dragInst.rotation = this.dragResizeOrigRotation;
			this.draw();
		}
		this.dragInst = null;
		this.dragInstances = [];
		this.dragStartRotations.clear();
		this.canvas.style.cursor = '';
	}

	private hitTest(cssX: number, cssY: number): MapInstance | null {
		const worldX = (cssX - this.panX) / this.zoom;
		const worldY = (cssY - this.panY) / this.zoom;
		const layerOrder: (keyof MapLayers)[] = ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'];
		for (const layerId of layerOrder) {
			const layer = this.layers[layerId];
			const defaultLocked = layerId === 'backgrounds' || layerId === 'prefabs';
			for (let i = layer.length - 1; i >= 0; i--) {
				const inst = layer[i]!;
				if (inst.hidden) continue;
				if (inst.locked ?? defaultLocked) continue;
				if (this.hitTestInstance(inst, worldX, worldY)) return inst;
			}
		}
		return null;
	}

	private hitTestInstance(inst: MapInstance, worldX: number, worldY: number): boolean {
		const cx = inst.x + inst.width / 2;
		const cy = inst.y + inst.height / 2;
		const dx = worldX - cx;
		const dy = worldY - cy;
		const cos = Math.cos(-inst.rotation);
		const sin = Math.sin(-inst.rotation);
		const localX = dx * cos - dy * sin;
		const localY = dx * sin + dy * cos;
		return Math.abs(localX) <= inst.width / 2 && Math.abs(localY) <= inst.height / 2;
	}

	private onWheel(e: WheelEvent) {
		e.preventDefault();
		// Normalise deltaMode so line-mode mice produce ~100 px per click,
		// matching what pixel-mode devices (trackpads) report.
		let delta = e.deltaY;
		if (e.deltaMode === 1) delta *= 30;
		if (e.deltaMode === 2) delta *= 600;
		// Proportional zoom: 100 px of scroll = one ZOOM_FACTOR step.
		// This naturally gives smooth, gentle steps for trackpad (small deltas,
		// many events) and the same per-notch feel for a mouse wheel.
		const factor = Math.pow(ZOOM_FACTOR, delta / 100);
		const rect = this.canvas.getBoundingClientRect();
		this.applyZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
	}

	private onContextMenu(e: MouseEvent) {
		if (this.panDragMoved) {
			e.preventDefault();
			this.panDragMoved = false;
			return;
		}
		if (!this.measureActive) return;
		e.preventDefault();
		this.deactivateMeasure();
	}

	private deactivateMeasure() {
		this.measureActive = false;
		this.measureStart = null;
		this.measureCurrent = null;
		this.canvas.style.cursor = '';
		this.draw();
		this.onMeasureDeactivate?.();
	}

	private onKeyDown(e: KeyboardEvent) {
		if (this.measureActive && e.key === 'Escape') {
			e.preventDefault();
			this.deactivateMeasure();
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
			if (this.selectedIds.size === 1) {
				const [instanceId] = this.selectedIds;
				for (const lid of ['tokens', 'objects', 'prefabs', 'tiles', 'backgrounds'] as const) {
					if (this.layers[lid].some(i => i.id === instanceId)) {
						e.preventDefault();
						this.onCopySelection?.(instanceId!, lid);
						break;
					}
				}
			}
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
			e.preventDefault();
			const worldX = (this.cssW() / 2 - this.panX) / this.zoom;
			const worldY = (this.cssH() / 2 - this.panY) / this.zoom;
			const snappedX = Math.round(worldX / this.cellSize) * this.cellSize;
			const snappedY = Math.round(worldY / this.cellSize) * this.cellSize;
			this.onPasteRequest?.(snappedX, snappedY);
			return;
		}

		if (!PAN_KEYS.has(e.key) || !(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const step = this.cellSize * this.zoom;
		if (e.key === 'ArrowRight') this.panX -= step;
		if (e.key === 'ArrowLeft')  this.panX += step;
		if (e.key === 'ArrowDown')  this.panY -= step;
		if (e.key === 'ArrowUp')    this.panY += step;
		this.draw();
	}

	private onDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('application/vtt-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	private onDrop(e: DragEvent) {
		e.preventDefault();
		const raw = e.dataTransfer?.getData('application/vtt-asset');
		if (!raw) return;

		let parsed: { assetPath: string; resourceUrl: string; category: string };
		try {
			parsed = JSON.parse(raw) as typeof parsed;
		} catch {
			return;
		}

		const rect = this.canvas.getBoundingClientRect();
		const cssX = e.clientX - rect.left;
		const cssY = e.clientY - rect.top;

		// Convert CSS drop position to world space, then snap to nearest grid corner.
		const worldX = (cssX - this.panX) / this.zoom;
		const worldY = (cssY - this.panY) / this.zoom;
		const snappedX = Math.round(worldX / this.cellSize) * this.cellSize;
		const snappedY = Math.round(worldY / this.cellSize) * this.cellSize;

		this.onAssetDrop?.({
			assetPath:   parsed.assetPath,
			resourceUrl: parsed.resourceUrl,
			category:    parsed.category,
			worldX:      snappedX,
			worldY:      snappedY,
		});
	}

	private draw() {
		const { ctx } = this;
		const W = this.cssW();
		const H = this.cssH();

		ctx.fillStyle = '#1a1a2e';
		ctx.fillRect(0, 0, W, H);

		// Backgrounds, tiles, and prefabs (structures) sit below the grid.
		this.drawLayer(this.layers.backgrounds);
		this.drawLayer(this.layers.tiles);
		this.drawLayer(this.layers.prefabs);

		const cellSize = this.cellSize * this.zoom;
		const startX = ((this.panX % cellSize) + cellSize) % cellSize;
		const startY = ((this.panY % cellSize) + cellSize) % cellSize;

		if (this.showGrid) {
			ctx.beginPath();
			ctx.strokeStyle = this.gridColor;
			ctx.lineWidth = 1;

			for (let x = startX; x < W; x += cellSize) {
				ctx.moveTo(x, 0);
				ctx.lineTo(x, H);
			}
			for (let y = startY; y < H; y += cellSize) {
				ctx.moveTo(0, y);
				ctx.lineTo(W, y);
			}

			ctx.stroke();
		}

		// Objects and tokens sit above the grid.
		this.drawLayer(this.layers.objects);
		this.drawLayer(this.layers.tokens);

		// Selection boxes drawn last so they always appear on top.
		if (this.selectedIds.size > 0) {
			const showHandle = this.activeMode === 'resize' && this.selectedIds.size === 1;
			for (const layerId of ['backgrounds', 'tiles', 'prefabs', 'objects', 'tokens'] as const) {
				for (const inst of this.layers[layerId]) {
					if (!inst.hidden && this.selectedIds.has(inst.id)) {
						this.drawSelectionBox(inst);
						if (showHandle) this.drawResizeHandle(inst);
					}
				}
			}
		}

		this.drawMeasurement();

		if (this.onAfterDraw) {
			this.onAfterDraw(this.computeSelectionBounds());
		}
	}

	private computeSelectionBounds(): ScreenBounds | null {
		if (this.selectedIds.size === 0) return null;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		let firstId: string | null = null;
		let firstLayerId: keyof MapLayers | null = null;
		let count = 0;

		for (const layerId of ['backgrounds', 'tiles', 'prefabs', 'objects', 'tokens'] as const) {
			for (const inst of this.layers[layerId]) {
				if (!this.selectedIds.has(inst.id) || inst.hidden) continue;
				if (firstId === null) { firstId = inst.id; firstLayerId = layerId; }
				minX = Math.min(minX, inst.x);
				minY = Math.min(minY, inst.y);
				maxX = Math.max(maxX, inst.x + inst.width);
				maxY = Math.max(maxY, inst.y + inst.height);
				count++;
			}
		}

		if (firstId === null) return null;

		return {
			x: this.canvasOffsetX + this.panX + minX * this.zoom,
			y: this.canvasOffsetY + this.panY + minY * this.zoom,
			w: (maxX - minX) * this.zoom,
			h: (maxY - minY) * this.zoom,
			instanceId: firstId,
			layerId: firstLayerId!,
			isMulti: count > 1,
		};
	}

	private drawLayer(instances: MapInstance[]) {
		for (const inst of instances) {
			this.drawInstance(inst);
		}
	}

	private drawInstance(inst: MapInstance) {
		if (inst.hidden) return;

		// Key the cache on assetPath (stable), NOT on the URL returned by
		// getResourcePath — that URL can include a varying query parameter
		// (e.g. mtime token) that changes between calls, producing a permanent
		// cache miss → new Image on every draw → exponential load loop → crash.
		let img = this.imageCache.get(inst.assetPath);

		if (img === undefined) {
			this.imageCache.set(inst.assetPath, null);
			const image = new Image();
			image.onload = () => {
				this.imageCache.set(inst.assetPath, image);
				this.draw();
			};
			image.onerror = () => {
				// Leave the cache entry as null so future draws skip it
				// rather than retrying and creating another load loop.
			};
			// getResourcePath is called exactly once per image, here.
			image.src = this.getResourcePath(inst.assetPath);
			return;
		}
		if (img === null) return; // loading or permanently failed

		const drawW = inst.width  * this.zoom;
		const drawH = inst.height * this.zoom;
		const drawX = this.panX + inst.x * this.zoom;
		const drawY = this.panY + inst.y * this.zoom;

		this.ctx.save();
		this.ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
		if (inst.rotation !== 0) this.ctx.rotate(inst.rotation);
		this.ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
		this.ctx.restore();
	}

	private drawSelectionBox(inst: MapInstance) {
		const drawW = inst.width  * this.zoom;
		const drawH = inst.height * this.zoom;
		const drawX = this.panX + inst.x * this.zoom;
		const drawY = this.panY + inst.y * this.zoom;
		this.ctx.save();
		this.ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
		if (inst.rotation !== 0) this.ctx.rotate(inst.rotation);
		this.ctx.strokeStyle = '#f97316';
		this.ctx.lineWidth = 2;
		this.ctx.strokeRect(-drawW / 2 - 2, -drawH / 2 - 2, drawW + 4, drawH + 4);
		this.ctx.restore();
	}

	private drawResizeHandle(inst: MapInstance) {
		const drawW = inst.width  * this.zoom;
		const drawH = inst.height * this.zoom;
		const drawX = this.panX + inst.x * this.zoom;
		const drawY = this.panY + inst.y * this.zoom;
		this.ctx.save();
		this.ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
		if (inst.rotation !== 0) this.ctx.rotate(inst.rotation);
		// Circle at the bottom-right corner in local canvas space.
		this.ctx.beginPath();
		this.ctx.arc(drawW / 2, drawH / 2, HANDLE_CSS_RADIUS, 0, Math.PI * 2);
		this.ctx.fillStyle = 'white';
		this.ctx.fill();
		this.ctx.strokeStyle = '#f97316';
		this.ctx.lineWidth = 2;
		this.ctx.stroke();
		this.ctx.restore();
	}

	private isOnResizeHandle(inst: MapInstance, worldX: number, worldY: number): boolean {
		// Transform cursor into the asset's local space and check distance from
		// the bottom-right corner, which sits at (width/2, height/2) in local space.
		const cx = inst.x + inst.width  / 2;
		const cy = inst.y + inst.height / 2;
		const dx = worldX - cx;
		const dy = worldY - cy;
		const cos = Math.cos(-inst.rotation);
		const sin = Math.sin(-inst.rotation);
		const localX = dx * cos - dy * sin;
		const localY = dx * sin + dy * cos;
		return Math.hypot(localX - inst.width / 2, localY - inst.height / 2) <= HANDLE_CSS_RADIUS / this.zoom;
	}

	private calcGridDist(dx: number, dy: number): number {
		const adx = Math.abs(dx);
		const ady = Math.abs(dy);
		switch (this.measureDiagonal) {
			case 'one-to-one':
				return Math.max(adx, ady);
			case 'alternating': {
				const diag = Math.min(adx, ady);
				const straight = Math.max(adx, ady) - diag;
				// Odd diagonals cost 1 square, even diagonals cost 2 squares.
				return straight + Math.floor(diag / 2) * 3 + (diag % 2);
			}
			case 'no-diagonal':
				return adx + ady;
			default: // 'exact'
				return Math.sqrt(dx * dx + dy * dy);
		}
	}

	private drawMeasurement() {
		if (!this.measureActive || !this.measureStart) return;
		const { ctx } = this;

		const startX = this.panX + (this.measureStart.gx + 0.5) * this.cellSize * this.zoom;
		const startY = this.panY + (this.measureStart.gy + 0.5) * this.cellSize * this.zoom;

		// Start dot
		ctx.save();
		ctx.beginPath();
		ctx.arc(startX, startY, 5, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
		ctx.fill();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();

		if (!this.measureCurrent) return;

		const endX = this.panX + (this.measureCurrent.gx + 0.5) * this.cellSize * this.zoom;
		const endY = this.panY + (this.measureCurrent.gy + 0.5) * this.cellSize * this.zoom;

		const dx = this.measureCurrent.gx - this.measureStart.gx;
		const dy = this.measureCurrent.gy - this.measureStart.gy;
		const gridDist = this.calcGridDist(dx, dy);
		if (gridDist === 0) return;

		// Dashed line (L-shaped for no-diagonal, straight otherwise)
		ctx.save();
		ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
		ctx.lineWidth = 2;
		ctx.setLineDash([6, 4]);
		ctx.beginPath();
		ctx.moveTo(startX, startY);
		if (this.measureDiagonal === 'no-diagonal') {
			ctx.lineTo(endX, startY); // horizontal segment
			ctx.lineTo(endX, endY);   // vertical segment
		} else {
			ctx.lineTo(endX, endY);
		}
		ctx.stroke();
		ctx.restore();

		// End dot
		ctx.save();
		ctx.beginPath();
		ctx.arc(endX, endY, 5, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
		ctx.fill();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.restore();

		const physDist = gridDist * this.measureUnits;
		const gridStr = String(Math.round(gridDist * 10) / 10);
		const physStr = String(Math.round(physDist * 10) / 10);
		const label = `${gridStr} sq · ${physStr} ${this.measureUnitLabel}`;

		// For no-diagonal, anchor label at the corner of the L; otherwise at the line midpoint.
		let labelX: number, labelY: number, textAngle: number;
		if (this.measureDiagonal === 'no-diagonal') {
			labelX = endX;
			labelY = startY;
			textAngle = 0;
		} else {
			labelX = (startX + endX) / 2;
			labelY = (startY + endY) / 2;
			textAngle = Math.atan2(endY - startY, endX - startX);
			// Keep text readable — flip if it would render upside-down.
			if (textAngle > Math.PI / 2)       textAngle -= Math.PI;
			else if (textAngle < -Math.PI / 2) textAngle += Math.PI;
		}

		ctx.save();
		ctx.translate(labelX, labelY);
		ctx.rotate(textAngle);

		ctx.font = 'bold 12px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		const tw = ctx.measureText(label).width;
		const th = 14;
		const pad = 5;
		const offsetY = -16;

		ctx.fillStyle = 'rgba(15, 20, 40, 0.85)';
		ctx.fillRect(-(tw / 2 + pad), offsetY - th / 2 - 1, tw + pad * 2, th + 2);

		ctx.fillStyle = 'rgba(220, 235, 255, 1)';
		ctx.fillText(label, 0, offsetY);

		ctx.restore();
	}
}
