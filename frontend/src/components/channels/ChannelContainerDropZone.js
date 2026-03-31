import { useDroppable } from "@dnd-kit/core";

export default function ChannelContainerDropZone({
  id,
  data,
  children,
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data,
  });

  return children({
    setNodeRef,
    isOver,
  });
}
