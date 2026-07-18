import type { Editor } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
    Bold,
    Italic,
    Underline,
    Strikethrough,
    List,
    ListOrdered,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Heading,
    Heading1,
    Heading2,
    Heading3,
    Type,
    ImagePlus,
    ChevronDown,
    Undo2,
    Redo2,
} from "lucide-react";
import { compressImage } from "../../lib/imageCompressor.ts";

interface ToolbarProps {
    editor: Editor | null;
}

export const Toolbar = ({ editor }: ToolbarProps) => {
    const { t } = useTranslation();
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!openMenu) return;
        const handler = (e: MouseEvent) => {
            if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [openMenu]);

    if (!editor) return null;

    const btnClass = (active: boolean) =>
        `btn btn-xs ${active ? "btn-active" : "btn-ghost"}`;

    const toggleMenu = (name: string) =>
        setOpenMenu((prev) => (prev === name ? null : name));

    const runAndClose = (action: () => void) => {
        action();
        setOpenMenu(null);
    };

    const toggleUnderline = () => {
        if (editor.isActive("strike")) {
            editor.chain().focus().unsetStrike().toggleUnderline().run();
        } else {
            editor.chain().focus().toggleUnderline().run();
        }
    };

    const toggleStrike = () => {
        if (editor.isActive("underline")) {
            editor.chain().focus().unsetUnderline().toggleStrike().run();
        } else {
            editor.chain().focus().toggleStrike().run();
        }
    };

    const activeHeadingIcon = editor.isActive("heading", { level: 1 })
        ? <Heading1 className="h-3.5 w-3.5" />
        : editor.isActive("heading", { level: 2 })
            ? <Heading2 className="h-3.5 w-3.5" />
            : editor.isActive("heading", { level: 3 })
                ? <Heading3 className="h-3.5 w-3.5" />
                : <Heading className="h-3.5 w-3.5" />;

    const activeAlignIcon = editor.isActive({ textAlign: "center" })
        ? <AlignCenter className="h-3.5 w-3.5" />
        : editor.isActive({ textAlign: "right" })
            ? <AlignRight className="h-3.5 w-3.5" />
            : <AlignLeft className="h-3.5 w-3.5" />;

    const hasActiveStyle = editor.isActive("bold") || editor.isActive("italic")
        || editor.isActive("underline") || editor.isActive("strike");

    return (
        <>
            <div
                ref={toolbarRef}
                className="flex flex-wrap items-center gap-0.5 p-1"
                role="toolbar"
                aria-label={t("editor.toolbar")}
                onMouseDown={(e) => e.preventDefault()}
            >
                {/* Undo / Redo */}
                <div className="flex gap-0.5" role="group" aria-label={t("editor.history")}>
                    <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => editor.chain().focus().undo().run()}
                        disabled={!editor.can().undo()}
                        aria-label={t("editor.undo")}
                    >
                        <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => editor.chain().focus().redo().run()}
                        disabled={!editor.can().redo()}
                        aria-label={t("editor.redo")}
                    >
                        <Redo2 className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="divider divider-horizontal mx-0" />

                {/* Heading dropdown */}
                <div className="relative" role="group" aria-label={t("editor.headings")}>
                    <button
                        type="button"
                        className={`btn btn-xs ${editor.isActive("heading") ? "btn-active" : "btn-ghost"} gap-0 pr-1`}
                        onClick={() => toggleMenu("heading")}
                        aria-label={t("editor.headings")}
                        aria-expanded={openMenu === "heading"}
                    >
                        {activeHeadingIcon}
                        <ChevronDown className="h-2.5 w-2.5" />
                    </button>
                    {openMenu === "heading" && (
                        <div className="absolute top-full left-0 mt-1 flex gap-0.5 p-1 bg-base-200 rounded-lg shadow-lg z-10">
                            <button type="button" className={btnClass(editor.isActive("heading", { level: 1 }))}
                                onClick={() => runAndClose(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
                                aria-label={t("editor.heading1")} aria-pressed={editor.isActive("heading", { level: 1 })}>
                                <Heading1 className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive("heading", { level: 2 }))}
                                onClick={() => runAndClose(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
                                aria-label={t("editor.heading2")} aria-pressed={editor.isActive("heading", { level: 2 })}>
                                <Heading2 className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive("heading", { level: 3 }))}
                                onClick={() => runAndClose(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
                                aria-label={t("editor.heading3")} aria-pressed={editor.isActive("heading", { level: 3 })}>
                                <Heading3 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Text style dropdown — stays open for multi-select */}
                <div className="relative" role="group" aria-label={t("editor.textFormatting")}>
                    <button
                        type="button"
                        className={`btn btn-xs ${hasActiveStyle ? "btn-active" : "btn-ghost"} gap-0 pr-1`}
                        onClick={() => toggleMenu("style")}
                        aria-label={t("editor.textFormatting")}
                        aria-expanded={openMenu === "style"}
                    >
                        <Type className="h-3.5 w-3.5" />
                        <ChevronDown className="h-2.5 w-2.5" />
                    </button>
                    {openMenu === "style" && (
                        <div className="absolute top-full left-0 mt-1 flex gap-0.5 p-1 bg-base-200 rounded-lg shadow-lg z-10">
                            <button type="button" className={btnClass(editor.isActive("bold"))}
                                onClick={() => editor.chain().focus().toggleBold().run()}
                                aria-label={t("editor.bold")} aria-pressed={editor.isActive("bold")}>
                                <Bold className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive("italic"))}
                                onClick={() => editor.chain().focus().toggleItalic().run()}
                                aria-label={t("editor.italic")} aria-pressed={editor.isActive("italic")}>
                                <Italic className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive("underline"))}
                                onClick={toggleUnderline}
                                aria-label={t("editor.underline")} aria-pressed={editor.isActive("underline")}>
                                <Underline className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive("strike"))}
                                onClick={toggleStrike}
                                aria-label={t("editor.strikethrough")} aria-pressed={editor.isActive("strike")}>
                                <Strikethrough className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>

                <div className="divider divider-horizontal mx-0" />

                {/* Lists — inline */}
                <div className="flex gap-0.5" role="group" aria-label={t("editor.lists")}>
                    <button
                        type="button"
                        className={btnClass(editor.isActive("bulletList"))}
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        aria-label={t("editor.bulletList")}
                        aria-pressed={editor.isActive("bulletList")}
                    >
                        <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        className={btnClass(editor.isActive("orderedList"))}
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        aria-label={t("editor.numberedList")}
                        aria-pressed={editor.isActive("orderedList")}
                    >
                        <ListOrdered className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="divider divider-horizontal mx-0" />

                {/* Alignment dropdown */}
                <div className="relative" role="group" aria-label={t("editor.alignment")}>
                    <button
                        type="button"
                        className="btn btn-xs btn-ghost gap-0 pr-1"
                        onClick={() => toggleMenu("align")}
                        aria-label={t("editor.alignment")}
                        aria-expanded={openMenu === "align"}
                    >
                        {activeAlignIcon}
                        <ChevronDown className="h-2.5 w-2.5" />
                    </button>
                    {openMenu === "align" && (
                        <div className="absolute top-full left-0 mt-1 flex gap-0.5 p-1 bg-base-200 rounded-lg shadow-lg z-10">
                            <button type="button" className={btnClass(editor.isActive({ textAlign: "left" }))}
                                onClick={() => runAndClose(() => editor.chain().focus().setTextAlign("left").run())}
                                aria-label={t("editor.alignLeft")} aria-pressed={editor.isActive({ textAlign: "left" })}>
                                <AlignLeft className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive({ textAlign: "center" }))}
                                onClick={() => runAndClose(() => editor.chain().focus().setTextAlign("center").run())}
                                aria-label={t("editor.alignCenter")} aria-pressed={editor.isActive({ textAlign: "center" })}>
                                <AlignCenter className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" className={btnClass(editor.isActive({ textAlign: "right" }))}
                                onClick={() => runAndClose(() => editor.chain().focus().setTextAlign("right").run())}
                                aria-label={t("editor.alignRight")} aria-pressed={editor.isActive({ textAlign: "right" })}>
                                <AlignRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>

                <div className="divider divider-horizontal mx-0" />

                {/* Image insert */}
                <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("editor.image")}
                >
                    <ImagePlus className="h-3.5 w-3.5" />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && editor) {
                            compressImage(file).then((dataUrl) => {
                                editor.chain().focus().setImage({ src: dataUrl }).run();
                            }).catch((err) => {
                                console.error("Failed to insert image:", err);
                            });
                        }
                        e.target.value = "";
                    }}
                />
            </div>
            <div className="divider my-0" />
        </>
    );
};
