import { useParams, useNavigate } from 'react-router-dom';
import { EditorProvider, useEditor } from '@/features/editor/context/EditorContext';
import { EditorLayout } from '@/features/editor/components/EditorLayout';
import PipelineStepper from '@/components/admin/PipelineStepper';

function EditorStepper() {
  const { blog } = useEditor();
  if (!blog) return null;
  return <PipelineStepper item={blog} className="mb-4" />;
}

export default function EditorPage() {
  const { blogId } = useParams();
  const navigate = useNavigate();

  return (
    <EditorProvider blogId={blogId} navigate={navigate}>
      <EditorStepper />
      <EditorLayout navigate={navigate} />
    </EditorProvider>
  );
}
