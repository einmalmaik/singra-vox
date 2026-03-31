import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function SortableChannelItem({
  id,
  data,
  disabled = false,
  children,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id,
    data,
    disabled,
  });

  return children({
    setNodeRef,
    attributes,
    listeners,
    isDragging,
    isOver,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
    },
  });
}
