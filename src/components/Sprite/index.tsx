import css from "./styles.module.css";
import type { Dino } from "../../types";
import { useLayoutEffect, useRef } from "react";
import { drawSprite, getImage } from "../../modules/sprites";

type Props = {
    d: Dino;
    flip?: boolean;
    className?: string;
};

export default function Sprite(props: Props) {
    const { d: dinosaur, flip = false, className = "" } = props;
    const ref = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const image = getImage(dinosaur.image);
        const draw = () => {
            context.clearRect(0, 0, canvas.width, canvas.height);
            drawSprite(context, dinosaur, canvas.width / 2, canvas.height - 4, canvas.width - 8, canvas.height - 8, flip);
        };
        draw();
        image.addEventListener("load", draw);
        return () => image.removeEventListener("load", draw);
    }, [dinosaur, flip]);
    return <canvas ref={ref} width="320" height="220" className={`${css.sprite} ${className}`} role="img" aria-label={dinosaur.name} />;
}
