import { RecipeEditor } from "@/components/recipes/recipe-editor";

export default function NewRecipePage() {
  return (
    <div className="px-6 py-10">
      <h1 className="text-display-md font-semibold leading-[1.47] tracking-[-0.374px] mb-6">新建配方</h1>
      <RecipeEditor />
    </div>
  );
}
