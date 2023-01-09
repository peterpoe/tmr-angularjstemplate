"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require("vscode");
// import * as myExtension from '../../extension';
suite('Test Suite', () => {
    test('@ngInject Regular Expressions', async () => {
        const doc = await vscode.workspace.openTextDocument({
            language: 'javascript',
        });
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(textEdit => {
            textEdit.insert(new vscode.Position(0, 0), 'ciao');
        });
        // Could be
        // an annotated function parameter -> /** @ngInject */ function(foo, bar, baz)
        // an annotated named function parameter -> /** @ngInject */ function FuncName(foo, bar, baz)
        // an annotated class constructor parameter --> /** @ngInject */ constructor(foo, bar, baz)
        // a provider $get method -> /** @ngInject */ $get(foo, bar, baz)
        // any annotated parameter list --> /** @ngInject */ (foo, bar, baz)
        // an annotated arrow function single parameter --> /** @ngInject */ foo =>
        // a jsdoc link in a comment --> /** {@link foo} */
        // any parameter list followed by string inject --> (foo, bar, baz) { 'ngInject'
    });
});
//# sourceMappingURL=extension.test.js.map