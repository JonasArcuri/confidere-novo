// Captura somente: reconhecimento de voz e IA são executados no serviço local.
class ObrafluxAudio extends AudioWorkletProcessor {
    constructor() { super(); this.buffer = []; }
    process(inputs, outputs) {
        const canal = inputs[0]?.[0];
        if (canal) {
            this.buffer.push(...canal);
            if (this.buffer.length >= 2048) {
                const bloco = new Float32Array(this.buffer);
                this.buffer = [];
                this.port.postMessage(bloco.buffer, [bloco.buffer]);
            }
        }
        outputs.forEach(output => output.forEach(channel => channel.fill(0)));
        return true;
    }
}
registerProcessor('obraflux-audio', ObrafluxAudio);
