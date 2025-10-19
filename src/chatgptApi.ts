import * as vscode from 'vscode';
import axios from 'axios';

export async function analyzeCodeWithChatGPT(code: string, filePath: string): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration().get<string>('codebaseAnalyzer.openAIApiKey');
    if (!apiKey) {
        throw new Error('OpenAI API key is not set. Please set it in the extension settings.');
    }

    const prompt = `You are a security expert. Analyze the following code for security vulnerabilities and risks. Return ONLY valid JSON in the following format:

{
  "findings": [
    {
      "vulnerability": "SQL Injection",
      "risk_score": "high",
      "filename": "server/routes/user.js",
      "lines_affected": [42, 47],
      "explanation": "User input is concatenated directly into an SQL query without parameterization.",
      "recommendation": "Use prepared statements or ORM query builders to prevent injection attacks."
    }
  ]
}

Each finding must include:
- vulnerability: the name/type (e.g. SQL Injection, XSS, Hardcoded Secret)
- risk_score: "low", "medium", or "high"
- filename: the relative path of the file (use: ${filePath})
- lines_affected: array of affected line numbers
- explanation: brief summary of why this is a vulnerability or risk
- recommendation: concise, actionable mitigation advice

If there are no findings, return {"findings": []}

Analyze this file: ${filePath}

${code}
`;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are a security expert.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 700
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const result = response.data.choices?.[0]?.message?.content;
    return result || 'No analysis result returned.';
}

export async function analyzeDependenciesWithChatGPT(dependencies: string[]): Promise<string> {
    const apiKey = vscode.workspace.getConfiguration().get<string>('codebaseAnalyzer.openAIApiKey');
    if (!apiKey) {
        throw new Error('OpenAI API key is not set. Please set it in the extension settings.');
    }

    const prompt = `You are a security expert. Analyze the following list of dependencies for known vulnerabilities. Return ONLY valid JSON in the following format:

{
  "findings": [
    {
      "vulnerability": "Vulnerability Name",
      "risk_score": "high",
      "filename": "requirements.txt",
      "lines_affected": [],
      "explanation": "Explanation of the vulnerability.",
      "recommendation": "How to fix or mitigate."
    }
  ]
}

Each finding must include:
- vulnerability: the name/type (e.g. Outdated Package, Known CVE, Hardcoded Secret)
- risk_score: "low", "medium", or "high"
- filename: the dependency file (e.g. requirements.txt, package.json)
- lines_affected: [] (empty array or N/A for dependencies)
- explanation: brief summary of why this is a vulnerability or risk
- recommendation: concise, actionable mitigation advice

If there are no findings, return {"findings": []}

Analyze these dependencies (one finding per vulnerability):

${dependencies.join('\n')}
`;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are a security expert.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 500
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const result = response.data.choices?.[0]?.message?.content;
    return result || 'No analysis result returned.';
}
