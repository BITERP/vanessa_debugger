/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { VanessaDebugSession } from './vanessaDebug';
import * as Net from 'net';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

/*
 * Set the following compile time flag to true if the
 * debug adapter should run inside the extension host.
 * Please note: the test suite does no longer work in this mode.
 */
const EMBED_DEBUG_ADAPTER = true;

export let COLD_RESTART = false;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('extension.vanessa-debug.run1c', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a feature file in the workspace folder",
			value: getCurrentFile()
		}).then((prev) => {
			// Start 1C

			const userParams = getRunParamsFor1C()

			if (prev && !COLD_RESTART) {

				const enterprise = '"C:\\Program Files (x86)\\1cv8\\common\\1cestart.exe" ENTERPRISE ';
				const db = userParams && userParams.settings.DEBUGGER_DB ? `/S "${userParams.settings.DEBUGGER_DB}" ` : '';
				const user = userParams && userParams.settings.DEBUGGER_DB_USER ? `/N "${userParams.settings.DEBUGGER_DB_USER}" ` : '';
				const psw = userParams && userParams.settings.DEBUGGER_DB_PSW ? `/P "${userParams.settings.DEBUGGER_DB_PSW}" ` : '';
				const vanessa = userParams && userParams.settings.DEBUGGER_VANESSA_PATH ? `/Execute "${userParams.settings.DEBUGGER_VANESSA_PATH}" ` : '';
				const feature = `feature=${getCurrentFile()} `
				const bps = `breaks=${getBreakPointsFile()} `
				const debugInfo = `debugInfo=${getVanessaDebugInfoFile()} `
				const commands = `commands=${getVanessaCommandsFile()} `
				const additional = `/C "${feature}${bps}${debugInfo}${commands}"`
				const run = `${enterprise}${db}${user}${psw}${vanessa}${additional}`
				exec(run, (err) => {
					if (err) {
						// node couldn't execute the command
						console.log(`err: ${err}`);
						return;
					}
				});
			}
			if (COLD_RESTART) {
				setRestartMode(false);
			}

			return prev;
		}) ;
	}));

	// register a configuration provider for 'vanessa' debug type
	const provider = new VanessaConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('vanessa', provider));
	context.subscriptions.push(provider);
}

export function deactivate() {
	// nothing to do
}

export function getCurrentFile(): string {
	const editor = vscode.window.activeTextEditor
	return editor ? editor.document.fileName : ''
}

export function getBreakPointsFile(): string {
	const breakPointsFileName = 'breaks.json'
	return `${vscode.workspace.rootPath}\\.vscode\\${breakPointsFileName}`
}

export function getVanessaDebugInfoFile(): string {
	const debugInfoFileName = 'debugInfo.json'
	return `${vscode.workspace.rootPath}\\.vscode\\${debugInfoFileName}`
}

export function getVanessaCommandsFile(): string {
	const debugCommandsFileName = 'commandsForVanessa.json'
	return `${vscode.workspace.rootPath}\\.vscode\\${debugCommandsFileName}`
}

export function getUserSettingsFile(): string {
	const userSettingsFileName = 'user_settings.json'
	return `${vscode.workspace.rootPath}\\${userSettingsFileName}`
}

export function setRestartMode(mode: boolean) {
	COLD_RESTART = mode
}

function getRunParamsFor1C(): IUserSettings | undefined {
	const userName = os.userInfo().username.toUpperCase()
	const settingsFile = getUserSettingsFile()
	const isExists = fs.existsSync(settingsFile)
	if (isExists) {
		const data = fs.readFileSync(settingsFile, 'utf-8');
		if (data) {
			const settings = JSON.parse(data) as { userSettings: Array<IUserSettings>}
			const s = settings.userSettings.find(s => s.user === userName.toUpperCase())
			return s
		}
	}

	return undefined
}


interface IUserSettings {
	user: string;
	settings: {
		DEBUGGER_DB?: string;
		DEBUGGER_DB_USER?: string;
		DEBUGGER_DB_PSW?: string;
		DEBUGGER_VANESSA_PATH: string;
	}
}

class VanessaConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _server?: Net.Server;

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined,
							  config: vscode.DebugConfiguration,
							  token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'feature' ) {
				config.type = 'vanessa';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '$' + '{command:Run1CEnerprise}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		if (EMBED_DEBUG_ADAPTER) {
			// start port listener on launch of first debug session
			if (!this._server) {

				// start listening on a random port
				this._server = Net.createServer(socket => {
					const session = new VanessaDebugSession();
					session.setRunAsServer(true);
					session.start(socket as NodeJS.ReadableStream, socket);
				}).listen(0);
			}

			// make VS Code connect to debug server instead of launching debug adapter
			config.debugServer = (this._server.address() as { port: number}).port;
		}

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}
