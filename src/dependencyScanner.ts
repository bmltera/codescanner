import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Dependency {
    name: string;
    version?: string;
    file: string;
    line: number;
}

export async function findDependencyFiles(): Promise<string[]> {
    const files = await vscode.workspace.findFiles('**/{requirements.txt,package.json}', '**/node_modules/**');
    return files.map(f => f.fsPath);
}

export function parseRequirementsTxt(filePath: string): Dependency[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const dependencies: Dependency[] = [];
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const match = trimmed.match(/^([a-zA-Z0-9_\-]+)([=<>!~]+[^\s#]+)?/);
            if (match) {
                dependencies.push({
                    name: match[1],
                    version: match[2] ? match[2] : undefined,
                    file: filePath,
                    line: idx + 1
                });
            }
        }
    });
    return dependencies;
}

export function parsePackageJson(filePath: string): Dependency[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    const dependencies: Dependency[] = [];
    const addDeps = (deps: any, depType: string) => {
        if (deps) {
            Object.keys(deps).forEach((name) => {
                dependencies.push({
                    name,
                    version: deps[name],
                    file: filePath,
                    line: 1 // JSON, so just mark as line 1
                });
            });
        }
    };
    addDeps(json.dependencies, 'dependencies');
    addDeps(json.devDependencies, 'devDependencies');
    return dependencies;
}
