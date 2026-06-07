import { setIcon } from 'obsidian';
import type { ScreenBounds } from './map-renderer';

const MENU_GAP = 8;

/** Persistent side panels that can cover the menu and make it unreachable. */
const OBSCURING_PANEL_SELECTOR = '.vtt-dice-tray, .vtt-content-browser';

export type ActionMode = 'move' | 'rotate' | 'resize';

export interface AssetActionMenuOptions {
	onLockToggle: () => void;
	onModeChange: (mode: ActionMode) => void;
	onDelete: () => void;
}

export class AssetActionMenu {
	private readonly container: HTMLElement;
	private readonly el: HTMLElement;
	private readonly lockBtn: HTMLElement;
	private readonly moveBtn: HTMLElement;
	private readonly rotateBtn: HTMLElement;
	private readonly resizeBtn: HTMLElement;
	private selectionKey: string | null = null;
	private lastIsLocked: boolean | null = null;

	constructor(container: HTMLElement, options: AssetActionMenuOptions) {
		this.container = container;
		this.el = container.createEl('div', { cls: 'vtt-asset-menu' });
		this.el.style.display = 'none';

		const makeBtn = (icon: string, title: string): HTMLElement => {
			const btn = this.el.createEl('button', {
				cls: 'vtt-asset-menu-btn',
				attr: { title, 'aria-label': title },
			});
			setIcon(btn, icon);
			btn.addEventListener('mousedown', e => e.preventDefault());
			return btn;
		};

		const modeBtn = (icon: string, title: string, mode: ActionMode): HTMLElement => {
			const btn = makeBtn(icon, title);
			btn.addEventListener('click', () => {
				this.setActiveMode(mode);
				options.onModeChange(mode);
			});
			return btn;
		};

		this.moveBtn   = modeBtn('move',       'Move',   'move');
		this.rotateBtn = modeBtn('rotate-cw',  'Rotate', 'rotate');
		this.resizeBtn = modeBtn('maximize-2', 'Resize', 'resize');
		this.lockBtn   = makeBtn('lock', 'Lock');
		this.lockBtn.addEventListener('click', () => options.onLockToggle());

		const deleteBtn = makeBtn('trash-2', 'Delete');
		deleteBtn.addClass('vtt-asset-menu-btn--danger');
		deleteBtn.addEventListener('click', () => options.onDelete());

		this.setActiveMode('move');
	}

	setActiveMode(mode: ActionMode): void {
		this.moveBtn.toggleClass('is-active',   mode === 'move');
		this.rotateBtn.toggleClass('is-active', mode === 'rotate');
		this.resizeBtn.toggleClass('is-active', mode === 'resize');
	}

	update(bounds: ScreenBounds | null, isLocked: boolean, onModeChange: (mode: ActionMode) => void): void {
		if (!bounds) {
			this.el.style.display = 'none';
			this.selectionKey = null;
			return;
		}

		const isMulti = bounds.isMulti ?? false;
		const key = isMulti ? `multi:${bounds.instanceId}` : bounds.instanceId;
		const isNewSelection = key !== this.selectionKey;
		this.selectionKey = key;

		// Hide resize for multi-select (resize is single-instance only).
		this.resizeBtn.style.display = isMulti ? 'none' : '';

		if (isNewSelection) {
			this.setActiveMode('move');
			onModeChange('move');
		}

		if (isLocked !== this.lastIsLocked) {
			setIcon(this.lockBtn, isLocked ? 'lock' : 'unlock');
			this.lockBtn.setAttribute('title', isLocked ? 'Unlock' : 'Lock');
			this.lockBtn.setAttribute('aria-label', isLocked ? 'Unlock' : 'Lock');
			this.lastIsLocked = isLocked;
		}

		this.el.style.display = '';

		// Read the actual rendered dimensions so we can position precisely.
		// Accessing offsetWidth/offsetHeight forces a synchronous reflow and
		// gives the real values regardless of button styles inherited from Obsidian.
		const menuW = this.el.offsetWidth;
		const menuH = this.el.offsetHeight;

		// Centre horizontally on the asset; show above unless too close to the top.
		const cx = bounds.x + bounds.w / 2;
		const isNearTop = bounds.y < menuH + MENU_GAP * 2;

		let left = cx - menuW / 2;
		let top = isNearTop
			? bounds.y + bounds.h + MENU_GAP
			: bounds.y - menuH - MENU_GAP;

		// Clamp to the visible canvas area so large assets or high zoom levels
		// can't push the menu (partially) off screen and out of reach.
		const containerW = this.container.clientWidth;
		const containerH = this.container.clientHeight;
		left = Math.max(MENU_GAP, Math.min(left, containerW - menuW - MENU_GAP));
		top  = Math.max(MENU_GAP, Math.min(top,  containerH - menuH - MENU_GAP));

		// For large/zoomed assets the on-screen position above can still land
		// behind a persistent side panel (dice tray, content browser) and be
		// unreachable. In that case fall back to dead-centre, which is always clear.
		if (this.overlapsObscuringPanel(left, top, menuW, menuH)) {
			left = (containerW - menuW) / 2;
			top  = (containerH - menuH) / 2;
		}

		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
		this.el.style.transform = '';
	}

	private overlapsObscuringPanel(left: number, top: number, w: number, h: number): boolean {
		const containerRect = this.container.getBoundingClientRect();
		const right = left + w;
		const bottom = top + h;

		const panels = Array.from(this.container.querySelectorAll<HTMLElement>(OBSCURING_PANEL_SELECTOR));
		for (const el of panels) {
			const r = el.getBoundingClientRect();
			const elLeft   = r.left   - containerRect.left;
			const elTop    = r.top    - containerRect.top;
			const elRight  = r.right  - containerRect.left;
			const elBottom = r.bottom - containerRect.top;
			if (left < elRight && right > elLeft && top < elBottom && bottom > elTop) return true;
		}
		return false;
	}

	destroy(): void {
		this.el.remove();
	}
}
