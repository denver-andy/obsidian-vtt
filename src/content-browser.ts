import { DataAdapter, setIcon } from 'obsidian';
import { AssetPicker, ContentCategory } from './asset-picker';

export type { ContentCategory };

export interface CustomAssetFolders {
	backgrounds: string;
	tiles: string;
	prefabs: string;
	objects: string;
	tokens: string;
}

interface CategoryConfig {
	id: ContentCategory;
	label: string;
	icon: string;
}

const CATEGORIES: CategoryConfig[] = [
	{ id: 'backgrounds', label: 'Backgrounds', icon: 'image' },
	{ id: 'tiles',       label: 'Tiles',       icon: 'mirror-rectangular' },
	{ id: 'prefabs',     label: 'Prefabs',     icon: 'layout-template' },
	{ id: 'objects',     label: 'Objects',     icon: 'box' },
	{ id: 'tokens',      label: 'Tokens',      icon: 'user' },
];

export class ContentBrowser {
	private readonly el: HTMLElement;
	private readonly tabEls = new Map<ContentCategory, HTMLElement>();
	private readonly searchEl: HTMLInputElement;
	private readonly contentEl: HTMLElement;
	private readonly pluginDir: string;
	private readonly adapter: DataAdapter;
	private customFolders: CustomAssetFolders;
	private activeCategory: ContentCategory = 'backgrounds';
	private filterText = '';
	private readonly pickers = new Map<ContentCategory, AssetPicker>();

	constructor(
		container: HTMLElement,
		pluginDir: string,
		adapter: DataAdapter,
		customFolders: CustomAssetFolders,
	) {
		this.pluginDir = pluginDir;
		this.adapter = adapter;
		this.customFolders = customFolders;

		this.el = container.createEl('div', { cls: 'vtt-content-browser' });
		this.el.createEl('div', { cls: 'vtt-hierarchy-header', text: 'Assets' });

		const tabs = this.el.createEl('div', { cls: 'vtt-browser-tabs' });

		const searchWrap = this.el.createEl('div', { cls: 'vtt-browser-search' });
		this.searchEl = searchWrap.createEl('input', {
			cls: 'vtt-browser-search-input',
			attr: { type: 'text', placeholder: 'Filter…', spellcheck: 'false' },
		}) as HTMLInputElement;
		this.searchEl.addEventListener('input', () => {
			this.filterText = this.searchEl.value.trim().toLowerCase();
			this.pickers.get(this.activeCategory)?.setFilter(this.filterText);
		});

		const clearBtn = searchWrap.createEl('button', {
			cls: 'vtt-browser-search-clear',
			attr: { title: 'Clear filter', 'aria-label': 'Clear filter' },
			text: '×',
		});
		clearBtn.addEventListener('mousedown', e => e.preventDefault());
		clearBtn.addEventListener('click', () => {
			this.searchEl.value = '';
			this.filterText = '';
			this.pickers.get(this.activeCategory)?.setFilter('');
		});

		this.contentEl = this.el.createEl('div', { cls: 'vtt-browser-content' });

		for (const cat of CATEGORIES) {
			const tab = tabs.createEl('button', {
				cls: 'vtt-browser-tab',
				attr: { 'aria-label': cat.label, title: cat.label },
			});
			setIcon(tab, cat.icon);
			tab.addEventListener('mousedown', e => e.preventDefault());
			tab.addEventListener('click', () => this.selectCategory(cat.id));
			this.tabEls.set(cat.id, tab);
		}

		this.selectCategory('backgrounds');
	}

	destroy() {
		for (const [, picker] of this.pickers) picker.destroy();
		this.el.remove();
	}

	updateCustomFolders(folders: CustomAssetFolders) {
		this.customFolders = folders;
		for (const [cat, picker] of this.pickers) {
			picker.updateCustomFolder(folders[cat]);
		}
	}

	private selectCategory(id: ContentCategory) {
		this.activeCategory = id;
		for (const [catId, tabEl] of this.tabEls) tabEl.toggleClass('is-active', catId === id);

		if (!this.pickers.has(id)) {
			this.pickers.set(id, new AssetPicker(this.contentEl, {
				adapter: this.adapter,
				pluginDir: this.pluginDir,
				category: id,
				customFolder: this.customFolders[id],
				mode: 'drag',
			}));
		}

		for (const [, picker] of this.pickers) picker.el.style.display = 'none';

		const picker = this.pickers.get(id)!;
		picker.el.style.display = '';
		// Re-apply text filter in case it changed while this picker was hidden.
		picker.setFilter(this.filterText);
	}
}
