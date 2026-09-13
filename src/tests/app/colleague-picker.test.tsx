import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColleaguePicker } from "@/components/matters/colleague-picker";

afterEach(cleanup);
function Picker() {
  const [selected, setSelected] = useState(["outside", "retired"]);
  return <ColleaguePicker people={[
    { id: "outside", name: "其他律师" },
    { id: "team", name: "团队律师", isTeammate: true },
    { id: "retired", name: "原协办", active: false }
  ]} selected={selected} onChange={setSelected} />;
}

describe("协办选择交互", () => {
  it("搜索不丢失已选协办，停用的原协办可移出且不能重新新增", () => {
    render(<Picker />);
    expect(screen.getByRole("checkbox", { name: "其他律师" })).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索律师姓名" }), { target: { value: "团队" } });
    expect(screen.getByRole("checkbox", { name: "其他律师" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "团队律师" }));
    expect(screen.getByRole("checkbox", { name: "团队律师" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "原协办（账号停用）" }));
    expect(screen.queryByRole("checkbox", { name: "原协办（账号停用）" })).not.toBeInTheDocument();
  });
});
