import css from "./styles.module.css";
import type { ConnectionStatus, GameData } from "../../types";
import Sprite from "../../components/Sprite";
import Title from "../../components/Title";

type Props = {
    data: GameData;
    status: ConnectionStatus;
    name: string;
    code: string;
    busy: boolean;
    setName: (name: string) => void;
    setCode: (code: string) => void;
    enter: (event: "create" | "join") => Promise<void>;
};

export default function Page(props: Props) {
    const { data, status, name, code, busy, setName, setCode, enter } = props;
    const dinosaurs = data.dinos;
    const front = dinosaurs.filter((d) => ["tyranno", "tricera", "brachio"].includes(d.id));
    const heroes = front.length === 3 ? front : [dinosaurs[0], dinosaurs[3], dinosaurs[5]].filter(Boolean);
    return (
        <main className={css["home-scene"]}>
            <div className={css["home-title"]}>
                <Title />
                <p className={css["home-title-sub"]}>공룡을 모으고, 살아남으세요!</p>
            </div>
            <section className={css["room-menu"]} aria-label="방 생성 또는 입장">
                <h2>함께할 탐험가를 찾으세요</h2>
                <label htmlFor="name">내 이름</label>
                <input id="name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="탐험가 이름" autoComplete="nickname" />
                <button className={`${css.primary} ${css["create-button"]}`} disabled={busy || status !== "connected"} onClick={() => enter("create")}>
                    새 방 만들기
                </button>
                <div className={css["join-divider"]}>
                    <span>방 코드가 있다면</span>
                </div>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        enter("join");
                    }}
                >
                    <label htmlFor="code">친구의 방 코드</label>
                    <div className={css["code-entry"]}>
                        <input
                            id="code"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                            maxLength={8}
                            placeholder="방 코드 입력"
                            autoComplete="off"
                        />
                        <button type="submit" disabled={!code || busy || status !== "connected"}>
                            입장
                        </button>
                    </div>
                </form>
            </section>
            <div className={css["home-dinos"]} aria-hidden="true">
                {heroes.map((d, i) => (
                    <Sprite key={d.id} d={d} flip={i === 0} className={`${css.hero} ${css[`hero-${i}`]}`} />
                ))}
            </div>
            <p className={css["home-footnote"]}>공룡을 클릭해 모으고, 상대의 고인돌을 무너뜨리세요.</p>
        </main>
    );
}
