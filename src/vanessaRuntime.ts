/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { getBreakPointsFile, getVanessaDebugInfoFile } from './extension';

import { EventEmitter } from 'events';

export interface VanessaBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class VanessaRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private readonly _breakPoints = new Map<string, VanessaBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private setCurrentLineInSource(debugInfo: {file: string, line: number, status: string, done?: boolean}) {
		const editor = vscode.window.activeTextEditor;
		if (editor && debugInfo.file !== editor.document.fileName) {
			vscode.workspace.openTextDocument(debugInfo.file).then(td => {
				vscode.window.showTextDocument(td).then(_ => {
					this.start(debugInfo.file, true);
					this._currentLine = debugInfo.line - 1;
					vscode.commands.executeCommand("workbench.action.debug.stepOver");
				})
			})
		} else {
			this._currentLine = debugInfo.line - 1;
			vscode.commands.executeCommand("workbench.action.debug.stepOver");
		}
	}

	constructor() {
		super();

		fs.watchFile(getVanessaDebugInfoFile(), (cur, prev) => {
			fs.readFile(getVanessaDebugInfoFile(), 'utf-8', (err, data) => {
				if (data) {
					const debugInfo = JSON.parse(data) as {file: string, line: number, status: string}
					this.setCurrentLineInSource(debugInfo);
				}
			})
		})
	}

	/**
	 * Start executing the given program.
	 */
	public start(featureFilePath: string, stopOnEntry: boolean) {

		this.loadSource(featureFilePath);
		this._currentLine = -1;

		this.verifyBreakpoints(this._sourceFile);

		if (stopOnEntry) {
			// we step once
			this.step(false, 'stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}

	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
		this.run(undefined);
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		this.run(event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {
		const frames = new Array<any>();
			frames.push({
				index: 0,
				name: `${this._currentLine + 1}`,
				file: this._sourceFile,
				line: this._currentLine
			});
		return {
			frames,
			count: 1
		};
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number) : VanessaBreakpoint {
		this._breakpointId = this._breakpointId + 1
		const bp = { verified: false, line, id: this._breakpointId } as VanessaBreakpoint;
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<VanessaBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		this.saveBreakpointsToFile(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number) : VanessaBreakpoint | undefined {
		const bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				this.saveBreakpointsToFile(path);
				return bp;
			}
		}
		this.saveBreakpointsToFile(path);
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
		this.saveBreakpointsToFile(path);
	}

	// private methods

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			this._sourceLines = fs.readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	private saveBreakpointsToFile(path: string) {
		const breakPointsInfo: Array<{file: string, breakpoints: Array<any>}> = [];
		this._breakPoints.forEach ((v, k) => breakPointsInfo.push({ file: k, breakpoints: v }));
		const info = JSON.stringify(breakPointsInfo);
		fs.writeFileSync(`${getBreakPointsFile()}`, info);
	}

	/**
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	private run(stepEvent?: string): void {
		for (let ln = this._currentLine + 1; ln < this._sourceLines.length; ln++) {
			if (this.fireEventsForLine(ln, stepEvent)) {
				this._currentLine = ln;
				return;
			}
		}
		this.sendEvent('end');
	}

	private verifyBreakpoints(path: string) : void {
		const bps = this._breakPoints.get(path);
		if (bps) {
			this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
				}
			});
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	private fireEventsForLine(ln: number, stepEvent?: string): boolean {

		// non-empty line
		if (stepEvent && this._currentLine <= ln) {
			this.sendEvent(stepEvent);
			return true;
		}

		// nothing interesting found -> continue
		return false;
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}
