import * as vscode from 'vscode';
import { findDependencyFiles, parseRequirementsTxt, parsePackageJson } from './dependencyScanner';
import { findSourceCodeFiles, readCodeFile } from './codeScanner';
import { analyzeDependenciesWithChatGPT, analyzeCodeWithChatGPT } from './chatgptApi';

// --- TreeView with Start Scan button and spinner state ---
class SecurityScanResultsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private scanning: boolean = false;

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    setScanning(scanning: boolean) {
        this.scanning = scanning;
        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (this.scanning) {
            // Unicode spinner + message
            return [
                new vscode.TreeItem('$(sync~spin) Scanning for vulnerabilities...')
            ];
        }
        // Show Start Scan button
        const startScanItem = new vscode.TreeItem('Start Scan');
        startScanItem.command = {
            command: 'extension.startScan',
            title: 'Start Scan'
        };
        startScanItem.iconPath = new vscode.ThemeIcon('play-circle');
        return [startScanItem];
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Register the TreeView for the Activity Bar
    const treeDataProvider = new SecurityScanResultsProvider();
    vscode.window.registerTreeDataProvider('securityScanResultsView', treeDataProvider);

    // Register the Start Scan command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.startScan', async () => {
            treeDataProvider.setScanning(true);

            const diagnosticsCollection = vscode.languages.createDiagnosticCollection('codebaseAnalyzer');
            diagnosticsCollection.clear();

            // 1. Scan for dependency files and analyze
            const depFiles = await findDependencyFiles();
            let allDependencies: string[] = [];
            for (const file of depFiles) {
                if (file.endsWith('requirements.txt')) {
                    const deps = parseRequirementsTxt(file).map(d => `${d.name}${d.version ? d.version : ''}`);
                    allDependencies.push(...deps);
                } else if (file.endsWith('package.json')) {
                    const deps = parsePackageJson(file).map(d => `${d.name}@${d.version}`);
                    allDependencies.push(...deps);
                }
            }
            if (allDependencies.length > 0) {
                try {
                    const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
                    vscode.window.showInformationMessage('Dependency analysis complete. See output for details.');
                    const output = vscode.window.createOutputChannel('Dependency Analysis');
                    output.appendLine(depAnalysis);
                    output.show();
                } catch (err: any) {
                    vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
                }
            }

            // 2. Scan code files and analyze (one prompt per file)
            const codeFiles = await findSourceCodeFiles();
            for (const filePath of codeFiles) {
                try {
                    const codeFile = readCodeFile(filePath);
                    const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);

                    // Parse ChatGPT output for issues (expecting: type, description, line)
                    const diagnostics: vscode.Diagnostic[] = [];
                    const issueRegex = /Type:\s*(.+?)\s*Description:\s*(.+?)\s*Line:\s*(\d+)/gi;
                    let match;
                    while ((match = issueRegex.exec(analysis)) !== null) {
                        const [, type, description, lineStr] = match;
                        const line = parseInt(lineStr, 10) - 1;
                        const range = new vscode.Range(line, 0, line, 100);
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `[${type.trim()}] ${description.trim()}`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                    if (diagnostics.length > 0) {
                        diagnosticsCollection.set(vscode.Uri.file(filePath), diagnostics);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
                }
            }

            treeDataProvider.setScanning(false);
            vscode.window.showInformationMessage('Codebase scan complete.');
        })
    );
}

export function deactivate() {}
