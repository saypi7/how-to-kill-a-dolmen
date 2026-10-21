import css from "./styles.module.css";
type Props = {
    hp: number;
    max: number;
    enemy?: boolean;
};

export default function Health(props: Props) {
    const { hp, max, enemy = false } = props;

    return (
        <div className={`${css["base-health"]} ${enemy ? css.enemy : ""}`}>
            <div className={css["health-track"]}>
                <div style={{ width: `${Math.max(0, hp / max) * 100}%` }} />
            </div>
            <span>
                {hp} / {max}
            </span>
        </div>
    );
}
