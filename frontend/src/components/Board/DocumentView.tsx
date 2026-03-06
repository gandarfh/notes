import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
// @ts-ignore — subpath export requires moduleResolution:bundler, but Vite resolves it fine
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { Markdown } from "tiptap-markdown";
import { useAppStore } from "../../store";
import { api } from "../../bridge/wails";
import { BlockEmbedExtension } from "./extensions/BlockEmbedExtension";
import { SlashMenuExtension } from "./extensions/SlashMenu";
import { CalloutExtension } from "./extensions/CalloutExtension";
import { ToggleExtension } from "./extensions/ToggleExtension";
import "./DocumentView.css";

const turnIntoOptions = [
  { label: "Text", action: (e: any) => e.chain().focus().setParagraph().run() },
  {
    label: "H1",
    action: (e: any) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: "H2",
    action: (e: any) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: "H3",
    action: (e: any) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet List",
    action: (e: any) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered List",
    action: (e: any) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Task List",
    action: (e: any) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Quote",
    action: (e: any) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Code Block",
    action: (e: any) => e.chain().focus().toggleCodeBlock().run(),
  },
];

function TurnIntoDropdown({ editor }: { editor: any }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="doc-turn-into">
      <button
        className="doc-bubble-btn"
        onClick={() => setOpen(!open)}
        title="Turn into"
      >
        Turn into ▾
      </button>
      {open && (
        <div className="doc-turn-into-dropdown">
          {turnIntoOptions.map((opt) => (
            <button
              key={opt.label}
              className="doc-turn-into-item"
              onClick={() => {
                opt.action(editor);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  pageId: string;
}

export function DocumentView({ pageId }: Props) {
  const initialContent = useAppStore((s) => s.activeBoardContent);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editorRef = useRef<any>(null);

  const saveContent = useCallback(
    (markdown: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        api.updateBoardContent(pageId, markdown);
        useAppStore.setState({ activeBoardContent: markdown });
      }, 500);
    },
    [pageId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "Type / for commands...",
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: true }),
      GlobalDragHandle,
      CalloutExtension,
      ToggleExtension,
      BlockEmbedExtension,
      SlashMenuExtension,
    ],
    content: initialContent || "",
    editorProps: {
      attributes: {
        class: "document-editor",
        spellcheck: "false",
      },
    },
    onUpdate({ editor }: any) {
      const md = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
      saveContent(md);
    },
  } as any);

  editorRef.current = editor;

  // Handle block insertion from slash menu
  useEffect(() => {
    const handler = async (e: Event) => {
      const { blockType } = (e as CustomEvent).detail;
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      // Create block via backend
      const block = await useAppStore
        .getState()
        .createBlock(blockType, 0, 0, 400, 300, "document");
      if (!block) return;

      // Insert embed node
      currentEditor.commands.insertBlockEmbed({
        blockId: block.id,
        blockType: block.type,
      });
    };

    window.addEventListener("board:insert-block", handler);
    return () => window.removeEventListener("board:insert-block", handler);
  }, []);

  // Cleanup save timer
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Handle image drop and paste
  useEffect(() => {
    if (!editor) return;

    const handleImageFile = (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        editor
          .chain()
          .focus()
          .setImage({ src: reader.result as string })
          .run();
      };
      reader.readAsDataURL(file);
    };

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      const imageFile = Array.from(files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFile) {
        event.preventDefault();
        handleImageFile(imageFile);
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files?.length) return;
      const imageFile = Array.from(files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFile) {
        event.preventDefault();
        handleImageFile(imageFile);
      }
    };

    const el = editor.view.dom;
    el.addEventListener("drop", handleDrop);
    el.addEventListener("paste", handlePaste);
    return () => {
      el.removeEventListener("drop", handleDrop);
      el.removeEventListener("paste", handlePaste);
    };
  }, [editor]);

  return (
    <div className="document-view">
      {editor && (
        <BubbleMenu editor={editor}>
          <div className="doc-bubble-menu">
            <TurnIntoDropdown editor={editor} />
            <div className="doc-bubble-divider" />
            <button
              className={`doc-bubble-btn ${editor.isActive("bold") ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              B
            </button>
            <button
              className={`doc-bubble-btn ${editor.isActive("italic") ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <em>I</em>
            </button>
            <button
              className={`doc-bubble-btn ${editor.isActive("strike") ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="Strikethrough"
            >
              <s>S</s>
            </button>
            <button
              className={`doc-bubble-btn ${editor.isActive("code") ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title="Code"
            >
              &lt;/&gt;
            </button>
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
