import * as ts from 'typescript/lib/tsserverlibrary';
import {LanguageService as CssLanguageService} from 'vscode-css-languageservice';
import {getEmmetCompletionParticipants} from 'vscode-emmet-helper';
import {FoldingRange, LanguageService as HtmlLanguageService} from 'vscode-html-languageservice';
import * as vscode from 'vscode-languageserver-types';

import {Configuration} from './configuration';
import {getDocumentRegions} from './embeddedSupport';
import {TemplateContext, TemplateLanguageService} from './typescript-template-language-service-decorator';
import {VirtualDocumentProvider} from './virtual_document_provider';

const emptyCompletionList: vscode.CompletionList = {
  isIncomplete: false,
  items: [],
};

interface HtmlCachedCompletionList {
  type: 'html'|'css';
  value: vscode.CompletionList;
}

class CompletionsCache {
  private _cachedCompletionsFile?: string;
  private _cachedCompletionsPosition?: ts.LineAndCharacter;
  private _cachedCompletionsContent?: string;
  private _completions?: HtmlCachedCompletionList;

  public getCached(context: TemplateContext, position: ts.LineAndCharacter):
      HtmlCachedCompletionList|undefined {
    if (this._completions && context.fileName === this._cachedCompletionsFile &&
        this._cachedCompletionsPosition &&
        arePositionsEqual(position, this._cachedCompletionsPosition) &&
        context.text === this._cachedCompletionsContent) {
      return this._completions;
    }

    return undefined;
  }

  public updateCached(
      context: TemplateContext, position: ts.LineAndCharacter,
      completions: HtmlCachedCompletionList) {
    this._cachedCompletionsFile = context.fileName;
    this._cachedCompletionsPosition = position;
    this._cachedCompletionsContent = context.text;
    this._completions = completions;
  }
}



export class EmbeddedTemplateLanguageService implements TemplateLanguageService {
  private _completionsCache = new CompletionsCache();

  constructor(
      private readonly typescript: typeof ts, private readonly configuration: Configuration,
      private readonly virtualDocumentProvider: VirtualDocumentProvider,
      private readonly htmlLanguageService: HtmlLanguageService,
      private readonly cssLanguageService: CssLanguageService, ) {}

  public getCompletionsAtPosition(context: TemplateContext, position: ts.LineAndCharacter):
      ts.CompletionInfo {
    const entry = this.getCompletionItems(context, position);
    return translateCompletionItemsToCompletionInfo(this.typescript, context, entry.value);
  }

  public getCompletionEntryDetails(
      context: TemplateContext, position: ts.LineAndCharacter,
      name: string): ts.CompletionEntryDetails {
    const entry = this.getCompletionItems(context, position);

    const item = entry.value.items.find(x => x.label === name);
    if (!item) {
      return {
        name,
        kind: this.typescript.ScriptElementKind.unknown,
        kindModifiers: '',
        tags: [],
        displayParts: toDisplayParts(name),
        documentation: [],
      };
    }
    return translateCompletionItemsToCompletionEntryDetails(this.typescript, item);
  }

  public getQuickInfoAtPosition(context: TemplateContext, position: ts.LineAndCharacter):
      ts.QuickInfo|undefined {
    const document = this.virtualDocumentProvider.createVirtualDocument(context);
    const documentRegions = getDocumentRegions(this.htmlLanguageService, document);
    const languageId = documentRegions.getLanguageAtPosition(position);

    switch (languageId) {
      case 'html':
        const htmlDoc = this.htmlLanguageService.parseHTMLDocument(document);
        const hover = this.htmlLanguageService.doHover(document, position, htmlDoc);
        return hover ? this.translateHover(hover, position, context) : undefined;

      case 'css':
        const stylesheet = this.cssLanguageService.parseStylesheet(document);
        const hover2 = this.cssLanguageService.doHover(document, position, stylesheet);
        return hover2 ? this.translateHover(hover2, position, context) : undefined;
    }

    return undefined;
  }

  public getSignatureHelpItemsAtPosition(_context: TemplateContext, _position: ts.LineAndCharacter):
      ts.SignatureHelpItems|undefined {
    // Html does not support sig help
    return undefined;
  }

  public getOutliningSpans(context: TemplateContext): ts.OutliningSpan[] {
    const document = this.virtualDocumentProvider.createVirtualDocument(context);
    const ranges = this.htmlLanguageService.getFoldingRanges(document);
    return ranges.map(range => this.translateOutliningSpan(context, range));
  }



  private translateOutliningSpan(context: TemplateContext, range: FoldingRange): ts.OutliningSpan {
    const startOffset =
        context.toOffset({line: range.startLine, character: range.startCharacter || 0});
    const endOffset = context.toOffset({line: range.endLine, character: range.endCharacter || 0});
    const span = {
      start: startOffset,
      length: endOffset - startOffset,
    };

    return {
      autoCollapse: false,
      kind: this.typescript.OutliningSpanKind.Code,
      bannerText: '',
      textSpan: span,
      hintSpan: span,
    };
  }


  private toVsRange(context: TemplateContext, start: number, end: number): vscode.Range {
    return {
      start: context.toPosition(start),
      end: context.toPosition(end),
    };
  }

  private translateHover(
      hover: vscode.Hover, position: ts.LineAndCharacter, context: TemplateContext): ts.QuickInfo {
    const header: ts.SymbolDisplayPart[] = [];
    const docs: ts.SymbolDisplayPart[] = [];
    const convertPart = (hoverContents: typeof hover.contents) => {
      if (typeof hoverContents === 'string') {
        docs.push({kind: 'unknown', text: hoverContents});
      } else if (Array.isArray(hoverContents)) {
        hoverContents.forEach(convertPart);
      } else {
        header.push({kind: 'unknown', text: hoverContents.value});
      }
    };
    convertPart(hover.contents);
    const start = context.toOffset(hover.range ? hover.range.start : position);
    return {
      kind: this.typescript.ScriptElementKind.string,
      kindModifiers: '',
      textSpan: {
        start,
        length: hover.range ? context.toOffset(hover.range.end) - start : 1,
      },
      displayParts: header,
      documentation: docs,
      tags: [],
    };
  }

  private getCompletionItems(context: TemplateContext, position: ts.LineAndCharacter):
      HtmlCachedCompletionList {
    const cached = this._completionsCache.getCached(context, position);
    if (cached) {
      return cached;
    }

    const document = this.virtualDocumentProvider.createVirtualDocument(context);
    const documentRegions = getDocumentRegions(this.htmlLanguageService, document);
    const languageId = documentRegions.getLanguageAtPosition(position);

    switch (languageId) {
      case 'html': {
        const htmlDoc = this.htmlLanguageService.parseHTMLDocument(document);
        const emmetResults: vscode.CompletionList = {
          isIncomplete: true,
          items: [],
        };
        this.htmlLanguageService.setCompletionParticipants([getEmmetCompletionParticipants(
            document, position, 'html',
            {
                // showAbbreviationSuggestions: true,
                // showExpandedAbbreviation: 'true',
                // showSuggestionsAsSnippets: false
            },
            emmetResults)]);
        const htmlCompletions: HtmlCachedCompletionList = {
          type: 'html',
          value: this.htmlLanguageService.doComplete(document, position, htmlDoc) ||
              emptyCompletionList,
        };

        if (emmetResults.items.length) {
          emmetResults.items[0].insertTextFormat
          htmlCompletions.value.items.push(...emmetResults.items);
          htmlCompletions.value.isIncomplete = true;
        }

        this._completionsCache.updateCached(context, position, htmlCompletions);
        return htmlCompletions;
      }
      case 'css': {
        const stylesheet = this.cssLanguageService.parseStylesheet(document);
        const emmetResults: vscode.CompletionList = {
          isIncomplete: true,
          items: [],
        };

        this.cssLanguageService.setCompletionParticipants([getEmmetCompletionParticipants(
            document, position, 'css', {
              showAbbreviationSuggestions: true,
              showExpandedAbbreviation: 'never',
              showSuggestionsAsSnippets: false
            },
            emmetResults)]);
        const completionsCss = this.cssLanguageService.doComplete(document, position, stylesheet) ||
            emptyCompletionList;
        const completions: vscode.CompletionList = {
          isIncomplete: false,
          items: [...completionsCss.items],
        };
        if (emmetResults.items.length) {
          completions.items.push(...emmetResults.items);
          completions.isIncomplete = true;
        }

        const styledCompletions: HtmlCachedCompletionList = {
          type: 'css',
          value: completions,
        };
        this._completionsCache.updateCached(context, position, styledCompletions);
        return styledCompletions;
      }
    }

    const completions: HtmlCachedCompletionList = {
      type: 'html',
      value: emptyCompletionList,
    };
    this._completionsCache.updateCached(context, position, completions);
    return completions;
  }
}


function translateCompletionItemsToCompletionInfo(
    typescript: typeof ts, context: TemplateContext,
    items: vscode.CompletionList): ts.CompletionInfo {
  return {
    isGlobalCompletion: false,
    isMemberCompletion: false,
    isNewIdentifierLocation: false,
    entries: items.items.map(x => translateCompetionEntry(typescript, context, x)),
  };
}

function translateCompletionItemsToCompletionEntryDetails(
    typescript: typeof ts, item: vscode.CompletionItem): ts.CompletionEntryDetails {
  return {
    name: item.label,
    kindModifiers: 'declare',
    kind: item.kind ? translateionCompletionItemKind(typescript, item.kind) :
                      typescript.ScriptElementKind.unknown,
    displayParts: toDisplayParts(item.detail),
    documentation: toDisplayParts(item.documentation),
    tags: [],
  };
}

function translateCompetionEntry(
    typescript: typeof ts, context: TemplateContext,
    vsItem: vscode.CompletionItem): ts.CompletionEntry {
  const kind = vsItem.kind ? translateionCompletionItemKind(typescript, vsItem.kind) :
                             typescript.ScriptElementKind.unknown;
  const entry: ts.CompletionEntry = {
    name: vsItem.label,
    kind,
    sortText: vsItem.sortText || vsItem.label,
  };

  if (vsItem.textEdit) {
    entry.insertText = vsItem.textEdit.newText;
    entry.replacementSpan = toTsSpan(context, vsItem.textEdit.range);
  }

  return entry;
}

function translateionCompletionItemKind(
    typescript: typeof ts, kind: vscode.CompletionItemKind): ts.ScriptElementKind {
  switch (kind) {
    case vscode.CompletionItemKind.Method:
      return typescript.ScriptElementKind.memberFunctionElement;
    case vscode.CompletionItemKind.Function:
      return typescript.ScriptElementKind.functionElement;
    case vscode.CompletionItemKind.Constructor:
      return typescript.ScriptElementKind.constructorImplementationElement;
    case vscode.CompletionItemKind.Field:
    case vscode.CompletionItemKind.Variable:
      return typescript.ScriptElementKind.variableElement;
    case vscode.CompletionItemKind.Class:
      return typescript.ScriptElementKind.classElement;
    case vscode.CompletionItemKind.Interface:
      return typescript.ScriptElementKind.interfaceElement;
    case vscode.CompletionItemKind.Module:
      return typescript.ScriptElementKind.moduleElement;
    case vscode.CompletionItemKind.Property:
      return typescript.ScriptElementKind.memberVariableElement;
    case vscode.CompletionItemKind.Unit:
    case vscode.CompletionItemKind.Value:
      return typescript.ScriptElementKind.constElement;
    case vscode.CompletionItemKind.Enum:
      return typescript.ScriptElementKind.enumElement;
    case vscode.CompletionItemKind.Keyword:
      return typescript.ScriptElementKind.keyword;
    case vscode.CompletionItemKind.Color:
      return typescript.ScriptElementKind.constElement;
    case vscode.CompletionItemKind.Reference:
      return typescript.ScriptElementKind.alias;
    case vscode.CompletionItemKind.File:
      return typescript.ScriptElementKind.moduleElement;
    case vscode.CompletionItemKind.Snippet:
    case vscode.CompletionItemKind.Text:
    default:
      return typescript.ScriptElementKind.unknown;
  }
}

function toDisplayParts(text: string | vscode.MarkupContent | undefined): ts.SymbolDisplayPart[] {
  if (!text) {
    return [];
  }
  return [{
    kind: 'text',
    text: typeof text === 'string' ? text : text.value,
  }];
}

function arePositionsEqual(left: ts.LineAndCharacter, right: ts.LineAndCharacter): boolean {
  return left.line === right.line && left.character === right.character;
}

function toTsSpan(context: TemplateContext, range: vscode.Range): ts.TextSpan {
  const editStart = context.toOffset(range.start);
  const editEnd = context.toOffset(range.end);

  return {
    start: editStart,
    length: editEnd - editStart,
  };
}

function toTsTextChange(context: TemplateContext, vsedit: vscode.TextEdit) {
  return {
    span: toTsSpan(context, vsedit.range),
    newText: vsedit.newText,
  };
}