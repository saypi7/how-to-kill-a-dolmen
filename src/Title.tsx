import { useState } from "react";
// 사용자 GIF 선화를 바탕으로 채색한 투명 PNG. 원본 GIF는 assets/에 보존합니다.
export default function Title() {
    const [custom, setCustom] = useState(true);
    return custom ? (
        <h1 className="title-art">
            <img className="custom-title" src="/title.png" alt="How to Kill a Dolmen" onError={() => setCustom(false)} />
        </h1>
    ) : (
        <h1 className="game-title title-fallback">
            How to Kill
            <br />
            <span>a Dolmen</span>
        </h1>
    );
}
