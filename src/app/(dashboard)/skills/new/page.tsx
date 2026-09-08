import { SkillForm } from "@/components/skills/skill-form";

export default function NewSkillPage() {
  return (
    <div className="px-6 py-10">
      <h1 className="text-display-md font-semibold leading-[1.47] tracking-[-0.374px] mb-6">新增 Skill</h1>
      <SkillForm />
    </div>
  );
}
