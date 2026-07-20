export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-6xl mb-4">🥚</div>
      <h1 className="text-4xl font-bold mb-2">AgriFortress</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 text-center max-w-xl">
        Farm-to-farm supply chain registry.
        <br />
        Signed records. Sovereign identity. No middlemen.
      </p>
      <div className="mt-8 text-sm text-gray-500">
        <a href="/api/health" className="underline">Health check</a>
        {' · '}
        <a href="/api/whoami" className="underline">Who am I?</a>
      </div>
    </main>
  );
}
