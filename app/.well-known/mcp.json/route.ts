export async function GET() {
  return Response.json(
    {
      name: "Loom Studio Rug Recolorizer",
      description:
        "Design custom hand-knotted rug colorways using real yarn libraries. Browse designs, pick yarn colors, and get a live photorealistic preview link.",
      url: "https://studio.carpetsbazaar.com/api/mcp",
      version: "1.0.0",
      tools: [
        {
          name: "browse_designs",
          description:
            "Browse the rug design catalog — see available designs with their color palettes",
        },
        {
          name: "browse_yarns",
          description:
            "Browse available yarn colors from real libraries — wool swatches, Oushak, OneLoom, and more",
        },
        {
          name: "create_preset_url",
          description:
            "Build a live preview URL that shows the rug with your chosen colors and photorealistic wool textures",
        },
      ],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
