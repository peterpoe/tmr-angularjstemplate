import * as vscode from 'vscode'
import camelcase = require('camelcase')

type TmrComponentDefinitionInfo =
  | false
  | {
      uri: vscode.Uri
      character: number
      line: number
    }

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

function isHTMLTag(document: vscode.TextDocument, wordRange: vscode.Range) {
  const beforeCharacterDelta =
    wordRange.start.character >= 2
      ? -2
      : wordRange.start.character === 1
      ? -1
      : 0
  const beforePosition = wordRange.start.translate(0, beforeCharacterDelta)
  const before = document.getText(
    new vscode.Range(beforePosition, wordRange.start)
  )
  if (before.length === 2 && before !== '</' && before[1] !== '<') {
    return false
  }
  if (before.length === 1 && before[0] !== '<') {
    return false
  }
  return true
}

function isInjected(symbolName: string, document: vscode.TextDocument) {
  // Only define classes and injected symbols
  const symbolPattern = escapeRegExp(symbolName)
  const injectPattern = `/\\*[\\S\\s]*@ng[Ii]nject\\b[\\S\\s]*\\*/`
  const parametersPattern = `\\((\\s*[^\\s)]+\\s*,)*\\s*${symbolPattern}(\\s*,\\s*\\S+)*\\s*,?\\s*\\)`
  // Could be
  // an annotated function parameter -> /** @ngInject */ function(foo, bar, baz)
  // an annotated named function parameter -> /** @ngInject */ function FuncName(foo, bar, baz)
  // an annotated class constructor parameter --> /** @ngInject */ constructor(foo, bar, baz)
  // a provider $get method -> /** @ngInject */ $get(foo, bar, baz)
  // any annotated parameter list --> /** @ngInject */ (foo, bar, baz)
  const pattern1 = `(${injectPattern}\\s*function\\s*\\w*|${injectPattern}\\s*(\\bconstructor|\\$get)|${injectPattern})\\s*${parametersPattern}`
  // an annotated arrow function single parameter --> /** @ngInject */ foo =>
  const pattern2 = `${injectPattern}\\s*${symbolPattern}\\s*=>`
  // a jsdoc link in a comment --> /** {@link foo} */
  const pattern3 = `\\{@link[^}]*?\\b${symbolPattern}\\b[^{]*?\\}`
  // any parameter list followed by string inject --> (foo, bar, baz) { 'ngInject'
  const pattern4 = `${parametersPattern}\\s*{\\s*'ngInject'`

  const documentText = document.getText()
  const isInjected = new RegExp(
    `(${pattern1})|(${pattern2})|(${pattern3})|(${pattern4})`
  ).test(documentText)

  return isInjected
}

const getTmrComponentDefinition = async function (
  componentName: string,
  token?: vscode.CancellationToken
) {
  // fileName is componentName - tmr prefix + .js - Example: tmrResourceForm --> resourceForm.js
  const fileName = `${componentName.replace(/^tmr(.)/, (_m, c) =>
    c.toLowerCase()
  )}.js`
  const uris = await vscode.workspace.findFiles(
    `{src/js/routes/**/${fileName},src/js/components/**/${fileName},src/app/routes/**/${fileName},src/app/components/**/${fileName},node_modules/tmr-frontend/src/js/routes/**/${fileName},node_modules/tmr-frontend/src/js/components/**/${fileName}}`,
    undefined,
    5,
    token
  )
  if (uris.length === 0) {
    return false
  }

  let i = 0
  let position: TmrComponentDefinitionInfo = false

  while (i < uris.length && position === false) {
    const uri = uris[i]
    const componentDocument = await vscode.workspace.openTextDocument(uri)
    const componentText = componentDocument.getText()
    const lines = componentText.split(/^/gm)
    let ii = 0
    let match: TmrComponentDefinitionInfo = false
    while (ii < lines.length && match === false) {
      const m = lines[ii].match(`(?<=export const )${componentName} = `)
      if (m !== null && m.index !== undefined) {
        match = { uri, character: m.index, line: ii }
      }
      ii++
    }
    if (match) {
      position = match
    }
    i++
  }

  return position
}

const angularJSTemplateProvideDefinition = async function (
  document: vscode.TextDocument,
  wordRange: vscode.Range,
  tagName: string,
  token?: vscode.CancellationToken
): Promise<vscode.DefinitionLink[] | undefined> {
  if (!isHTMLTag(document, wordRange)) {
    return
  }

  const componentName = camelcase(tagName)
  const definition = await getTmrComponentDefinition(componentName, token)

  if (!definition) {
    return
  }

  const { uri, line, character } = definition
  return [
    {
      targetUri: uri,
      targetRange: new vscode.Range(
        line,
        //  here ‾‾‾∨
        // tmrFoo = {
        character + componentName.length + 3,
        // Peek view seems to show max 9 lines anyway
        line + 9,
        0
      ),
      targetSelectionRange: new vscode.Range(
        line,
        character,
        line,
        character + componentName.length
      ),
    },
  ]
}

class AngularJSTemplateDefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.DefinitionLink[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) {
      return
    }

    const tagName = document.getText(wordRange)

    if (tagName.startsWith('tmr-')) {
      return angularJSTemplateProvideDefinition(
        document,
        wordRange,
        tagName,
        token
      )
    }
  }
}

class AngularJSDefinitionProvider {
  // Provide definitions for dependency injections
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) {
      return
    }

    const symbolName = document.getText(wordRange)

    // These are ng/ui router/angular material symbols,
    // that are handled in hover
    if (symbolName.startsWith('$')) {
      return
    }

    if (!isInjected(symbolName, document)) {
      return
    }

    const symbols = (
      await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        symbolName
      )
    )
      // We only care about exact matches
      .filter(symbol => {
        if (symbol.kind === vscode.SymbolKind.Function) {
          return `${symbolName}()` === symbol.name
        }
        return symbolName === symbol.name
      })
      // Accept only symbols located in src/js (core) or src/app (customization)
      .filter(
        symbol =>
          symbol.location.uri.path.includes('/src/js/') ||
          symbol.location.uri.path.includes('/src/app/')
      )

    return symbols.map(({ location }) => location)
  }
}

class AngularJsExternalServices {
  static ngServices = [
    '$anchorScroll',
    '$anchorScrollProvider',
    '$animate',
    '$animateCss',
    '$animateProvider',
    '$cacheFactory',
    '$compile',
    '$compileProvider',
    '$controller',
    '$controllerProvider',
    '$document',
    '$exceptionHandler',
    '$filter',
    '$filterProvider',
    '$http',
    '$httpBackend',
    '$httpParamSerializer',
    '$httpParamSerializerJQLike',
    '$httpProvider',
    '$interpolate',
    '$interpolateProvider',
    '$interval',
    '$jsonpCallbacks',
    '$locale',
    '$location',
    '$locationProvider',
    '$log',
    '$logProvider',
    '$parse',
    '$parseProvider',
    '$q',
    '$qProvider',
    '$rootElement',
    '$rootScope',
    '$rootScopeProvider',
    '$sce',
    '$sceDelegate',
    '$sceDelegateProvider',
    '$sceProvider',
    '$scope',
    '$templateCache',
    '$templateRequest',
    '$templateRequestProvider',
    '$timeout',
    '$window',
    '$xhrFactory',
  ]

  static uiRouterServices = [
    '$state',
    '$stateParams',
    '$transitions',
    '$transition$',
  ]

  static ngMaterialServices = [
    '$mdAriaProvider',
    '$mdBottomSheet',
    '$mdColors',
    '$mdCompiler',
    '$mdCompilerProvider',
    '$mdDateLocaleProvider',
    '$mdDialog',
    '$mdDialogProvider',
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
  ]
  static ngTranslateServices = ['$translate', '$translateProvider']

  getAngularJSDocumentation(symbolName: string) {
    if (symbolName === '$scope') {
      return `AngularJS Service: _$scope_  
            https://docs.angularjs.org/guide/scope`
    }
    if (symbolName.endsWith('Provider')) {
      return `AngularJS Provider: _${symbolName}_  
      https://docs.angularjs.org/api/ng/provider/${symbolName}`
    }
    return `AngularJS Service: _${symbolName}_  
          https://docs.angularjs.org/api/ng/service/${symbolName}`
  }

  getUIRouterDocumentation(symbolName: string) {
    const url = `https://ui-router.github.io/ng1/docs/latest/modules/injectables.html#${symbolName
      .replace(/\$/g, '\\_')
      .toLowerCase()}`
    return `UI Router Service: _${symbolName}_  
    [${url}](${url})`
  }

  getNgTranslateDocumentation(symbolName: string) {
    return `Angular Translate: _${symbolName}_  
    https://angular-translate.github.io/docs/#/api/pascalprecht.translate.${symbolName}`
  }

  getNgMaterialDocumentation(symbolName: string) {
    return `Angular Material: _${symbolName}_  
    https://material.angularjs.org/latest/api/service/${symbolName}`
  }
}

class AngularJsHoverProvider extends AngularJsExternalServices {
  async provideHover(document: vscode.TextDocument, position: vscode.Position) {
    // Shows hover info with link to documentation of
    // ng/ui router/angular material symbols
    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) {
      return
    }
    const symbolName = document.getText(wordRange)

    if (!symbolName.startsWith('$')) {
      return
    }

    if (!isInjected(symbolName, document)) {
      return
    }

    if (AngularJsHoverProvider.ngServices.includes(symbolName)) {
      return new vscode.Hover(this.getAngularJSDocumentation(symbolName))
    }

    if (AngularJsHoverProvider.uiRouterServices.includes(symbolName)) {
      return new vscode.Hover(this.getUIRouterDocumentation(symbolName))
    }

    if (AngularJsHoverProvider.ngTranslateServices.includes(symbolName)) {
      return new vscode.Hover(this.getNgTranslateDocumentation(symbolName))
    }

    if (AngularJsHoverProvider.ngMaterialServices.includes(symbolName)) {
      return new vscode.Hover(this.getNgMaterialDocumentation(symbolName))
    }
  }
}

class AngularJsCompletionItemProvider extends AngularJsExternalServices {
  completionList = new vscode.CompletionList([
    ...AngularJsCompletionItemProvider.ngServices.map(label => ({
      label,
      description: 'AngularJS',
      documentation: new vscode.MarkdownString(
        this.getAngularJSDocumentation(label)
      ),
      kind: vscode.CompletionItemKind.Function,
    })),
    ...AngularJsCompletionItemProvider.uiRouterServices.map(label => ({
      label,
      description: 'UI Router',
      documentation: new vscode.MarkdownString(
        this.getUIRouterDocumentation(label)
      ),
      kind: vscode.CompletionItemKind.Function,
    })),
    ...AngularJsCompletionItemProvider.ngTranslateServices.map(label => ({
      label,
      description: 'Angular Translate',
      documentation: new vscode.MarkdownString(
        this.getNgTranslateDocumentation(label)
      ),
      kind: vscode.CompletionItemKind.Function,
    })),
    ...AngularJsCompletionItemProvider.ngMaterialServices.map(label => ({
      label,
      description: 'Angular Material',
      documentation: new vscode.MarkdownString(
        this.getNgMaterialDocumentation(label)
      ),
      kind: vscode.CompletionItemKind.Function,
    })),
  ])

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    const wordRange = document.getWordRangeAtPosition(position)
    if (!wordRange) {
      return
    }
    const word = document.getText(wordRange)

    if (!isInjected(word, document)) {
      return
    }

    return this.completionList
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      'angularjstemplate',
      new AngularJSTemplateDefinitionProvider()
    ),
    vscode.languages.registerDefinitionProvider(
      'javascript',
      new AngularJSDefinitionProvider()
    ),
    vscode.languages.registerCompletionItemProvider(
      'javascript',
      new AngularJsCompletionItemProvider()
    ),
    vscode.languages.registerHoverProvider(
      'javascript',
      new AngularJsHoverProvider()
    )
  )
}

export function deactivate() {}
