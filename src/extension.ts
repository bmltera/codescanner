import * as vscode from 'vscode';
import { findDependencyFiles, parseRequirementsTxt, parsePackageJson } from './dependencyScanner';
import { findSourceCodeFiles, readCodeFile } from './codeScanner';
import { analyzeDependenciesWithChatGPT, analyzeCodeWithChatGPT } from './chatgptApi';

// --- TreeView with Start Scan button and spinner state ---
class SecurityScanResultsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private scanning: boolean = false;
    private scanResults: string[] = [];

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    setScanning(scanning: boolean) {
        this.scanning = scanning;
        this.refresh();
    }

    setScanResults(results: string[]) {
        this.scanResults = results;
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
        // Add scan results below the Start Scan button
        const resultItems = this.scanResults.map(result => {
            const item = new vscode.TreeItem(result);
            item.iconPath = new vscode.ThemeIcon('warning');
            return item;
        });
        return [startScanItem, ...resultItems];
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
            // Debug: log scan start
            console.log('[CodeScanner] Scan started');

            const diagnosticsCollection = vscode.languages.createDiagnosticCollection('codebaseAnalyzer');
            diagnosticsCollection.clear();

            // Collect scan results for TreeView
            const scanResults: string[] = [];

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
                    // Debug: log prompt to Debug Console
                    console.log('[ChatGPT Dependency Prompt]', allDependencies);
                    const depAnalysis = await analyzeDependenciesWithChatGPT(allDependencies);
                    // Debug: log response to Debug Console
                    console.log('[ChatGPT Dependency Response]', depAnalysis);
                    vscode.window.showInformationMessage('Dependency analysis complete. See output for details.');
                    const output = vscode.window.createOutputChannel('Dependency Analysis');
                    output.appendLine(depAnalysis);
                    output.show();
                    // Add summary to TreeView
                    scanResults.push('Dependency analysis complete.');
                } catch (err: any) {
                    vscode.window.showErrorMessage('Dependency analysis failed: ' + err.message);
                    scanResults.push('Dependency analysis failed.');
                }
            }

            // 2. Scan code files and analyze (one prompt per file)
            const codeFiles = await findSourceCodeFiles();
            let codeIssuesFound = false;
            for (const filePath of codeFiles) {
                try {
                    const codeFile = readCodeFile(filePath);
                    // Debug: log prompt to Debug Console
                    console.log('[ChatGPT Code Prompt]', { filePath, content: codeFile.content });
                    const analysis = await analyzeCodeWithChatGPT(codeFile.content, filePath);
                    // Debug: log response to Debug Console
                    console.log('[ChatGPT Code Response]', { filePath, analysis });

                    // Parse ChatGPT output for issues (expecting: type, description, line)
                    const diagnostics: vscode.Diagnostic[] = [];
                    const issueRegex = /Type:\s*(.+?)\s*Description:\s*(.+?)\s*Line:\s*(\d+)/gi;
                    let match;
                    let fileIssues: string[] = [];
                    while ((match = issueRegex.exec(analysis)) !== null) {
                        const [, type, description, lineStr] = match;
                        const line = parseInt(lineStr, 10) - 1;
                        const range = new vscode.Range(line, 0, line, 100);
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            `[${type.trim()}] ${description.trim()}`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                        fileIssues.push(`${filePath}: [${type.trim()}] ${description.trim()} (Line ${line + 1})`);
                    }
                    if (diagnostics.length > 0) {
                        diagnosticsCollection.set(vscode.Uri.file(filePath), diagnostics);
                        codeIssuesFound = true;
                        scanResults.push(...fileIssues);
                    }
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Code analysis failed for ${filePath}: ${err.message}`);
                    scanResults.push(`Code analysis failed for ${filePath}`);
                }
            }
            if (!codeIssuesFound) {
                scanResults.push('No code issues found.');
            }

            treeDataProvider.setScanResults(scanResults);
            treeDataProvider.setScanning(false);
            // Debug: log scan end
            console.log('[CodeScanner] Scan ended');
            vscode.window.showInformationMessage('Codebase scan complete.');
        })
    );
}

export function deactivate() {}
