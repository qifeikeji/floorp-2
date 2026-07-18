import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useCallback, useMemo, useRef } from "react";

const ALLOWED_SRC_PATTERNS = [
    /^https:\/\//,
    /^data:image\/(jpeg|png|gif|webp|svg\+xml);/,
];

function isSafeSrc(src: unknown): boolean {
    if (typeof src !== "string") return false;
    return ALLOWED_SRC_PATTERNS.some((pattern) => pattern.test(src));
}

export function ResizableImage({ node, updateAttributes, selected }: NodeViewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const safeSrc = useMemo(() => (isSafeSrc(node.attrs.src) ? node.attrs.src as string : ""), [node.attrs.src]);

    const handleResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX;
            const startWidth = imgRef.current?.offsetWidth || 200;

            const onMouseMove = (ev: MouseEvent) => {
                const newWidth = Math.max(40, Math.round(startWidth + (ev.clientX - startX)));
                updateAttributes({ width: newWidth });
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };

            document.addEventListener("mousemove", onMouseMove, { passive: true });
            document.addEventListener("mouseup", onMouseUp);
        },
        [updateAttributes],
    );

    return (
        <NodeViewWrapper className="my-2">
            <div className="relative inline-block max-w-full">
                <img
                    ref={imgRef}
                    src={safeSrc}
                    alt={node.attrs.alt || ""}
                    style={node.attrs.width ? { width: `${node.attrs.width}px` } : undefined}
                    className={`block max-w-full h-auto rounded-lg ${selected ? "ring-2 ring-primary/60" : ""}`}
                    draggable={false}
                />
                {selected && (
                    <div
                        className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-primary rounded-full cursor-se-resize shadow"
                        onMouseDown={handleResize}
                    />
                )}
            </div>
        </NodeViewWrapper>
    );
}
