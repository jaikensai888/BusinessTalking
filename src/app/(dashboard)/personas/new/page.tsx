import { PersonaForm } from "@/components/personas/persona-form";

export default function NewPersonaPage() {
  return (
    <div className="px-6 py-10">
      <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] mb-6">新增人格</h1>
      <PersonaForm />
    </div>
  );
}
