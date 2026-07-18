# pages-notes: Lexical → TipTap 移行計画

## 背景

Lexical エディタは Chromium ベースのブラウザで主に開発・テストされており、Gecko（Firefox/Floorp）の `contenteditable` 実装との相性問題が深刻。

### 発生している問題
- エディタ内でマウスクリック・矢印キー移動時にカーソル（キャレット）が消失する
- React の再レンダー時に Firefox が `contenteditable` のフォーカスを別要素に移動させる
- `React.memo` での再レンダー防止、blur ハンドラでのフォーカス復元、Toolbar の直接 DOM 操作化など多数の対策を試みたが根本解決に至らず

### 根本原因
Gecko の `contenteditable` + React DOM reconciliation + Lexical の3者間の相互作用。Lexical の内部実装が Gecko の挙動を十分に考慮していない。

## 移行先: TipTap (ProseMirror)

### 選定理由
- ProseMirror ベースで Firefox/Gecko のサポートが成熟している
- ProseMirror は 2015 年から Firefox をファーストクラスでサポート
- リッチテキスト編集機能（見出し、太字、リスト、配置など）が同等に実装可能
- React 統合 (`@tiptap/react`) が提供されている
- 活発なコミュニティとドキュメント

### 必要なパッケージ
```
@tiptap/react
@tiptap/starter-kit        # 基本的な編集機能（太字、イタリック、見出し、リスト等）
@tiptap/extension-underline
@tiptap/extension-text-align
@tiptap/extension-placeholder
```

## 移行手順

### Phase 1: エディタコア置換
1. Lexical 関連パッケージを削除 (`lexical`, `@lexical/react`, `@lexical/rich-text`, `@lexical/list`, `@lexical/selection`)
2. TipTap パッケージをインストール
3. `RichTextEditor.tsx` を TipTap の `useEditor` + `EditorContent` で書き直す
4. `Toolbar.tsx` を TipTap の `editor.isActive()` / `editor.chain()` API で書き直す
5. `config.ts` (Lexical editorConfig) を削除

### Phase 2: データ互換性
1. 保存形式を Lexical JSON → TipTap/ProseMirror JSON に変更
2. 既存の Lexical JSON データからの移行関数を作成
3. プレーンテキストへのフォールバックは維持

### Phase 3: 機能確認
1. 太字、イタリック、下線、取り消し線
2. 見出し (H1, H2, H3)
3. 箇条書きリスト、番号付きリスト
4. テキスト配置（左、中央、右）
5. Undo/Redo
6. カーソル移動（矢印キー、マウスクリック） ← 最重要テスト項目

### Phase 4: クリーンアップ
1. `React.memo` ハックが不要なら削除
2. Toolbar の直接 DOM 操作が不要なら React state に戻す
3. デバッグログの削除
4. 不要な依存パッケージの削除

## 影響範囲
- `src/components/editor/RichTextEditor.tsx` — 全面書き直し
- `src/components/editor/Toolbar.tsx` — 全面書き直し
- `src/components/editor/config.ts` — 削除
- `src/App.tsx` — `handleEditorChange` の型変更（Lexical SerializedEditorState → TipTap JSONContent）
- `package.json` — 依存パッケージ入れ替え

## 変更不要なファイル
- `src/components/notes/NoteList.tsx`
- `src/components/notes/NoteItem.tsx`
- `src/components/notes/NoteSearch.tsx`
- `src/components/common/ConfirmModal.tsx`
- `src/components/common/SaveStatus.tsx`
- `src/lib/dataManager.ts`（保存形式は文字列なので透過的）
- `src/lib/i18n/` 以下全て
- `src/types/note.ts`

## TipTap エディタの基本実装例

```tsx
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';

const Editor = ({ content, onChange }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
  });

  return <EditorContent editor={editor} />;
};
```

## TipTap Toolbar の基本実装例

```tsx
// TipTap では editor.isActive() で状態を取得し、
// editor.chain().focus().toggleBold().run() でコマンドを実行する。
// React state は不要 — editor インスタンスが状態を持つ。

<button
  className={editor.isActive('bold') ? 'btn-active' : 'btn-ghost'}
  onClick={() => editor.chain().focus().toggleBold().run()}
>
  Bold
</button>
```
