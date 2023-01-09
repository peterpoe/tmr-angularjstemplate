"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require("vscode");
// import * as myExtension from '../../extension';
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    test('@ngInject', async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: 'javascript',
        });
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(textEdit => {
            textEdit.insert(new vscode.Position(0, 0), 'ciao');
        });
        assert.strictEqual('ciao', doc.getText());
    });
});
//# sourceMappingURL=extension.test.js.map