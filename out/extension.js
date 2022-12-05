"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const camelcase = require("camelcase");
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
function isHTMLTag(document, wordRange) {
    const beforeCharacterDelta = wordRange.start.character >= 2
        ? -2
        : wordRange.start.character === 1
            ? -1
            : 0;
    const beforePosition = wordRange.start.translate(0, beforeCharacterDelta);
    const before = document.getText(new vscode.Range(beforePosition, wordRange.start));
    if (before.length === 2 && before !== '</' && before[1] !== '<') {
        return false;
    }
    if (before.length === 1 && before[0] !== '<') {
        return false;
    }
    return true;
}
function isInjected(symbolName, document) {
    // Only define classes and injected symbols
    const symbolPattern = escapeRegExp(symbolName);
    const injectPattern = `/\\\*{1,2}\\s*@ng[Ii]nject\\s*\\*/`;
    // Could be
    // an annotated function parameter -> /** @ngInject */ function(foo, bar, baz)
    // an annotated name function parameter -> /** @ngInject */ function FuncName(foo, bar, baz)
    // a class constructor parameter --> constructor(foo, bar, baz)
    //    (@todo check if injected? --> constructor(foo, bar, baz) { 'ngInject')
    // an annotated arrow function parameter --> /** @ngInject */ (foo, bar, baz) =>
    // a provider $get method -> /** @ngInject */ $get(foo, bar, baz)
    const pattern1 = `(${injectPattern}\\s*function\\s*\\w*|\\bconstructor\\b|${injectPattern}|${injectPattern}\\s*\\$get)\\s*\\((\\s*[^\\s)]+\\s*,)*\\s*${symbolPattern}(\\s*,\\s*\\S+)*\\s*,?\\s*\\)`;
    // an annotated arrow function single parameter --> /** @ngInject */ foo =>
    const pattern2 = `${injectPattern}\\s*${symbolPattern}\\s*=>`;
    // a jsdoc link in a comment --> /** {@link foo} */
    const pattern3 = `\\{@link[^}]*?\\b${symbolPattern}\\b[^{]*?\\}`;
    const documentText = document.getText();
    const isInjected = new RegExp(pattern1).test(documentText) ||
        new RegExp(pattern2).test(documentText) ||
        new RegExp(pattern3).test(documentText);
    return isInjected;
}
const getTmrComponentDefinition = async function (componentName, token) {
    // fileName is componentName - tmr prefix + .js - Example: tmrResourceForm --> resourceForm.js
    const fileName = `${componentName.replace(/^tmr(.)/, (_m, c) => c.toLowerCase())}.js`;
    const uris = await vscode.workspace.findFiles(`{src/js/routes/**/${fileName},src/js/components/**/${fileName}},{src/app/routes/**/${fileName},src/app/components/**/${fileName}},{node_modules/tmr-frontend/src/js/routes/**/${fileName},node_modules/tmr-frontend/src/js/components/**/${fileName}}`, undefined, 5, token);
    if (uris.length === 0) {
        return false;
    }
    let i = 0;
    let position = false;
    while (i < uris.length && position === false) {
        const uri = uris[i];
        const componentDocument = await vscode.workspace.openTextDocument(uri);
        const componentText = componentDocument.getText();
        const lines = componentText.split(/^/gm);
        let ii = 0;
        let match = false;
        while (ii < lines.length && match === false) {
            const m = lines[ii].match(`(?<=export const )${componentName} = `);
            if (m !== null && m.index !== undefined) {
                match = { uri, character: m.index, line: ii };
            }
            ii++;
        }
        if (match) {
            position = match;
        }
        i++;
    }
    return position;
};
const angularJSTemplateProvideDefinition = async function (document, wordRange, tagName, token) {
    if (!isHTMLTag(document, wordRange)) {
        return;
    }
    const componentName = camelcase(tagName);
    const definition = await getTmrComponentDefinition(componentName, token);
    if (!definition) {
        return;
    }
    const { uri, line, character } = definition;
    return [
        {
            targetUri: uri,
            targetRange: new vscode.Range(line, 
            //  here ‾‾‾∨
            // tmrFoo = {
            character + componentName.length + 3, 
            // Peek view seems to show max 9 lines anyway
            line + 9, 0),
            targetSelectionRange: new vscode.Range(line, character, line, character + componentName.length),
        },
    ];
};
class AngularJSTemplateDefinitionProvider {
    constructor(context) {
        this.context = context;
    }
    async provideDefinition(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return;
        }
        const tagName = document.getText(wordRange);
        if (tagName.startsWith('tmr-')) {
            return angularJSTemplateProvideDefinition(document, wordRange, tagName, token);
        }
    }
}
class AngularJSDefinitionProvider {
    constructor(context) {
        this.context = context;
    }
    // Provide definitions for injected AngularJS services
    async provideDefinition(document, position) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return;
        }
        const symbolName = document.getText(wordRange);
        // These are ng/ui router/angular material symbols,
        // that are handled in hover
        if (symbolName.startsWith('$')) {
            return;
        }
        if (!isInjected(symbolName, document)) {
            return;
        }
        const symbols = (await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', symbolName))
            // We only care about exact matches
            .filter(symbol => {
            if (symbol.kind === vscode.SymbolKind.Function) {
                return `${symbolName}()` === symbol.name;
            }
            return symbolName === symbol.name;
        })
            // Accept only symbols located in src/js (core) or src/app (customization)
            .filter(symbol => symbol.location.uri.path.includes('/src/js/') ||
            symbol.location.uri.path.includes('/src/app/'));
        return symbols.map(({ location }) => location);
    }
}
class AngularJsExternalServices {
    getAngularJSDocumentation(symbolName) {
        if (symbolName === '$scope') {
            return `AngularJS Service: _$scope_  
            https://docs.angularjs.org/guide/scope`;
        }
        return `AngularJS Service: _${symbolName}_  
          https://docs.angularjs.org/api/ng/service/${symbolName}`;
    }
    getUIRouterDocumentation(symbolName) {
        return `UI Router Service: _${symbolName}_  
    https://ui-router.github.io/ng1/docs/latest/modules/injectables.html#${symbolName
            .replace('$', '_')
            .toLowerCase()}`;
    }
    getNgTranslateDocumentation(symbolName) {
        return `Angular Translate: _${symbolName}_  
    https://angular-translate.github.io/docs/#/api/pascalprecht.translate.${symbolName}`;
    }
    getNgMaterialDocumentation(symbolName) {
        return `Angular Material: _${symbolName}_  
    https://material.angularjs.org/latest/api/service/${symbolName}`;
    }
}
AngularJsExternalServices.ngServices = [
    '$anchorScroll',
    '$animate',
    '$animateCss',
    '$cacheFactory',
    '$templateCache',
    '$compile',
    '$controller',
    '$document',
    '$exceptionHandler',
    '$filter',
    '$httpParamSerializer',
    '$httpParamSerializerJQLike',
    '$http',
    '$xhrFactory',
    '$httpBackend',
    '$interpolate',
    '$interval',
    '$jsonpCallbacks',
    '$locale',
    '$location',
    '$log',
    '$parse',
    '$q',
    '$rootElement',
    '$rootScope',
    '$sceDelegate',
    '$sce',
    '$templateRequest',
    '$timeout',
    '$window',
    '$scope',
];
AngularJsExternalServices.uiRouterServices = [
    '$state',
    '$stateParams',
    '$transitions',
    '$transition$',
];
AngularJsExternalServices.ngMaterialServices = [
    '$mdAriaProvider',
    '$mdBottomSheet',
    '$mdColors',
    '$mdCompiler',
    '$mdDateLocaleProvider',
    '$mdDialog',
    '$mdGestureProvider',
    '$mdIcon',
    '$mdIconProvider',
    '$mdInkRipple',
    '$mdInkRippleProvider',
    '$mdInteraction',
    '$mdLiveAnnouncer',
    '$mdMedia',
    '$mdPanel',
    '$mdPanelProvider',
    '$mdProgressCircular',
    '$mdSidenav',
    '$mdSticky',
    '$mdTheming',
    '$mdThemingProvider',
    '$mdToast',
];
AngularJsExternalServices.ngTranslateServices = ['$translate', '$translateProvider'];
class AngularJsHoverProvider extends AngularJsExternalServices {
    async provideHover(document, position) {
        // Shows hover info with link to documentation of
        // ng/ui router/angular material symbols
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return;
        }
        const symbolName = document.getText(wordRange);
        if (!symbolName.startsWith('$')) {
            return;
        }
        if (!isInjected(symbolName, document)) {
            return;
        }
        if (AngularJsHoverProvider.ngServices.includes(symbolName)) {
            return new vscode.Hover(this.getAngularJSDocumentation(symbolName));
        }
        if (AngularJsHoverProvider.uiRouterServices.includes(symbolName)) {
            return new vscode.Hover(this.getUIRouterDocumentation(symbolName));
        }
        if (AngularJsHoverProvider.ngTranslateServices.includes(symbolName)) {
            return new vscode.Hover(this.getNgTranslateDocumentation(symbolName));
        }
        if (AngularJsHoverProvider.ngMaterialServices.includes(symbolName)) {
            return new vscode.Hover(this.getNgMaterialDocumentation(symbolName));
        }
    }
}
class AngularJsCompletionItemProvider extends AngularJsExternalServices {
    provideCompletionItems(document, position) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return;
        }
        const word = document.getText(wordRange);
        if (!isInjected(word, document)) {
            return;
        }
        return new vscode.CompletionList([
            ...AngularJsCompletionItemProvider.ngServices.map(label => ({
                label,
                description: 'AngularJS',
                documentation: new vscode.MarkdownString(this.getAngularJSDocumentation(label)),
                kind: vscode.CompletionItemKind.Function,
            })),
            ...AngularJsCompletionItemProvider.uiRouterServices.map(label => ({
                label,
                description: 'UI Router',
                documentation: new vscode.MarkdownString(this.getUIRouterDocumentation(label)),
                kind: vscode.CompletionItemKind.Function,
            })),
            ...AngularJsCompletionItemProvider.ngTranslateServices.map(label => ({
                label,
                description: 'Angular Translate',
                documentation: new vscode.MarkdownString(this.getNgTranslateDocumentation(label)),
                kind: vscode.CompletionItemKind.Function,
            })),
            ...AngularJsCompletionItemProvider.ngMaterialServices.map(label => ({
                label,
                description: 'Angular Material',
                documentation: new vscode.MarkdownString(this.getNgMaterialDocumentation(label)),
                kind: vscode.CompletionItemKind.Function,
            })),
        ]);
    }
}
function activate(context) {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider('angularjstemplate', new AngularJSTemplateDefinitionProvider(context)), vscode.languages.registerDefinitionProvider('javascript', new AngularJSDefinitionProvider(context)), vscode.languages.registerCompletionItemProvider('javascript', new AngularJsCompletionItemProvider()), vscode.languages.registerHoverProvider('javascript', new AngularJsHoverProvider()));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map