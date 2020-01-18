import * as ts from 'typescript';
import * as vscode from 'vscode-languageserver-types';

import {TemplateContext} from './typescript-template-language-service-decorator';

export class VirtualDocumentProvider {
  public createVirtualDocument(context: TemplateContext, useRawText: boolean = false):
      vscode.TextDocument {
    const contents = useRawText ? context.rawText : context.text;
    let uri = 'untitled://embedded.html';
    let languageId = 'html';

    if (context.typescript.isArrayLiteralExpression(context.node.parent) &&
        context.typescript.isPropertyAssignment(context.node.parent.parent) &&
        context.node.parent.parent.name.getText() == 'styles') {
      uri = 'untitled://embedded.css';
      languageId = 'css';
    }

    return {
      uri,
      languageId,
      version: 1,
      getText: () => contents,
      positionAt: (offset: number) => { return context.toPosition(offset); },
      offsetAt: (p: vscode.Position) => { return context.toOffset(p); },
      lineCount: contents.split(/\n/g).length + 1,
    };
  }

  public toVirtualDocPosition(position: ts.LineAndCharacter): ts.LineAndCharacter {
    return position;
  }

  public fromVirtualDocPosition(position: ts.LineAndCharacter): ts.LineAndCharacter {
    return position;
  }

  public toVirtualDocOffset(offset: number): number { return offset; }

  public fromVirtualDocOffset(offset: number): number { return offset; }
}