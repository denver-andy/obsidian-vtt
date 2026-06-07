/** Generic snapshot-stack history. Each entry is the state captured immediately
 *  before a change; redo entries are derived from the current state at undo time. */
export class UndoManager<T> {
	private undoStack: T[] = [];
	private redoStack: T[] = [];

	constructor(private readonly maxSize = 100) {}

	/** Record the state as it was just before a change. Clears the redo stack. */
	record(beforeSnapshot: T) {
		this.undoStack.push(beforeSnapshot);
		if (this.undoStack.length > this.maxSize) this.undoStack.shift();
		this.redoStack = [];
	}

	/** Pop the most recent snapshot, pushing the current state onto the redo stack. */
	undo(currentSnapshot: T): T | null {
		const previous = this.undoStack.pop();
		if (previous === undefined) return null;
		this.redoStack.push(currentSnapshot);
		return previous;
	}

	/** Pop the most recently undone snapshot, pushing the current state back onto the undo stack. */
	redo(currentSnapshot: T): T | null {
		const next = this.redoStack.pop();
		if (next === undefined) return null;
		this.undoStack.push(currentSnapshot);
		return next;
	}

	canUndo(): boolean { return this.undoStack.length > 0; }
	canRedo(): boolean { return this.redoStack.length > 0; }

	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}
}
