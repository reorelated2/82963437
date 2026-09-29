import PageShell from "@/components/PageShell";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const community = slug.replaceAll("-", " ");

  return (
    <PageShell>
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-3xl font-semibold capitalize">{community}</h1>
        <p className="mt-3 max-w-3xl text-slate-600">Neighborhood insights, active homes, schools, and market snapshots for {community}.</p>
      </section>
    </PageShell>
  );
}
