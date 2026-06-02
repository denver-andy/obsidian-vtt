import { DataAdapter, setIcon } from 'obsidian';

type ContentCategory = 'backgrounds' | 'tiles' | 'prefabs' | 'objects' | 'tokens';

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

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

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
			this.contentEl.empty();
			void this.renderContent(this.activeCategory);
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
			this.contentEl.empty();
			void this.renderContent(this.activeCategory);
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
		this.el.remove();
	}

	/** Call after plugin settings change to re-render the visible category. */
	updateCustomFolders(folders: CustomAssetFolders) {
		this.customFolders = folders;
		this.contentEl.empty();
		void this.renderContent(this.activeCategory);
	}

	private selectCategory(id: ContentCategory) {
		this.activeCategory = id;

		for (const [catId, tabEl] of this.tabEls) {
			tabEl.toggleClass('is-active', catId === id);
		}

		this.contentEl.empty();
		void this.renderContent(id);
	}

	private async renderContent(category: ContentCategory) {
		const allFiles = await this.collectFiles(category);
		const files = this.filterText
			? allFiles.filter(f => f.name.toLowerCase().includes(this.filterText))
			: allFiles;

		this.contentEl.empty();

		if (files.length === 0) {
			const config = CATEGORIES.find(c => c.id === category);
			const label = config?.label ?? category;
			const empty = this.contentEl.createEl('div', { cls: 'vtt-browser-empty' });
			const msg = this.filterText && allFiles.length > 0
				? `No matches for "${this.searchEl.value.trim()}"`
				: `No ${label.toLowerCase()} yet`;
			empty.createEl('span', { text: msg });
			return;
		}

		for (const file of files) {
			const item = this.contentEl.createEl('div', {
				cls: 'vtt-browser-item',
				attr: {
					title: file.source === 'custom' ? `Custom: ${file.name}` : file.name,
					draggable: 'true',
				},
			});
			if (file.source === 'custom') {
				item.addClass('vtt-browser-item--custom');
			}

			const src = this.adapter.getResourcePath(file.path);
			const thumb = item.createEl('img', {
				cls: 'vtt-browser-item-thumb',
				attr: { draggable: 'false' },
			});
			thumb.src = src;
			thumb.alt = file.name;
			thumb.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.showImageModal(src, file.name);
			});

			item.createEl('span', { text: file.name, cls: 'vtt-browser-item-name' });

			item.addEventListener('dragstart', (e) => {
				if (!e.dataTransfer) return;
				e.dataTransfer.effectAllowed = 'copy';
				e.dataTransfer.setData('application/vtt-asset', JSON.stringify({
					assetPath: file.path,
					resourceUrl: src,
					category,
				}));
			});
		}
	}

	private showImageModal(src: string, name: string) {
		const overlay = document.body.createEl('div', { cls: 'vtt-image-modal-overlay' });
		const img = overlay.createEl('img', { cls: 'vtt-image-modal-img' });
		img.src = src;
		img.alt = name;

		const close = () => {
			overlay.remove();
			document.removeEventListener('keydown', onKey);
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

		overlay.addEventListener('click', close);
		document.addEventListener('keydown', onKey);
	}

	private async collectFiles(category: ContentCategory): Promise<Array<{ name: string; path: string; source: 'builtin' | 'custom' }>> {
		const results: Array<{ name: string; path: string; source: 'builtin' | 'custom' }> = [];

		const builtinPath = `${this.pluginDir}/assets/${category}`;
		for (const file of await this.listImages(builtinPath)) {
			results.push({ ...file, source: 'builtin' });
		}

		const customPath = this.customFolders[category];
		if (customPath) {
			const builtinNames = new Set(results.map(r => r.name));
			for (const file of await this.listImages(customPath)) {
				if (!builtinNames.has(file.name)) {
					results.push({ ...file, source: 'custom' });
				}
			}
		}

		return results;
	}

	private async listImages(folderPath: string): Promise<Array<{ name: string; path: string }>> {
		try {
			const listed = await this.adapter.list(folderPath);
			return listed.files
				.filter(f => {
					const dot = f.lastIndexOf('.');
					return dot !== -1 && IMAGE_EXTENSIONS.has(f.slice(dot).toLowerCase());
				})
				.map(f => ({ name: f.slice(f.lastIndexOf('/') + 1), path: f }));
		} catch {
			return [];
		}
	}
}
