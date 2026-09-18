import type { IconName } from "./IconSprite";

/* 스프라이트 아이콘 하나. 크기는 목업의 `.i` / `.i.sm` / `.i.lg` 를 따른다.
 *
 * 아이콘만 있는 컨트롤에는 라벨을 붙여야 한다. 이 컴포넌트는 항상
 * `aria-hidden` 이므로 접근 가능한 이름은 감싸는 요소가 제공한다. */

type Props = {
  name: IconName;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function Icon({ name, size = "md", className }: Props) {
  const classes = ["i", size === "sm" ? "sm" : size === "lg" ? "lg" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <svg className={classes} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
