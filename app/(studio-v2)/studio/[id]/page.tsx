import { notFound } from "next/navigation";
import { loadStudioDesign } from "@/lib/studio-data";
import StudioScreen from "@/components/studio-v2/StudioScreen";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function StudioDesignPage({ params }: Props) {
  const { id } = await params;
  const data = await loadStudioDesign(id);
  if (!data) notFound();

  return (
    <StudioScreen
      design={data.design}
      palette={data.palette}
      yarns={data.yarns}
      initialColorMap={data.initialColorMap}
      tenant={data.tenant}
    />
  );
}
