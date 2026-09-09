import * as vscode from 'vscode';

interface CircuitMetadata {
    n_qubits?: number;
    total_steps?: number;
    depth?: number;
}

interface StepSummary {
    gate_name?: string;
    global_entropy?: number;
}

interface RenderSnapshot {
    metadata?: CircuitMetadata;
    steps?: StepSummary[];
}

export class MetadataItem extends vscode.TreeItem {
    public readonly children: MetadataItem[];

    constructor(
        label: string,
        value?: string,
        collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        children: MetadataItem[] = []
    ) {
        super(label, collapsible);
        this.description = value;
        this.children = children;
    }
}

/**
 * 侧边栏「QCO Metadata」：静态显示线路规模，动态显示当前门与全局熵。
 */
export class QCOMetadataProvider implements vscode.TreeDataProvider<MetadataItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MetadataItem | undefined>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private metadata: CircuitMetadata = {};
    private steps: StepSummary[] = [];
    private currentStep = 0;

    public setData(data: unknown): void {
        const snapshot = (data ?? {}) as RenderSnapshot;
        this.metadata = snapshot.metadata ?? {};
        this.steps = snapshot.steps ?? [];
        this.currentStep = 0;
        this.refresh();
    }

    public setStep(step: number): void {
        if (this.steps.length === 0 || step === this.currentStep) {
            return;
        }
        this.currentStep = Math.min(Math.max(step, 0), this.steps.length - 1);
        this.refresh();
    }

    public clear(): void {
        this.metadata = {};
        this.steps = [];
        this.currentStep = 0;
        this.refresh();
    }

    public refresh(): void {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    public getTreeItem(element: MetadataItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: MetadataItem): MetadataItem[] {
        if (element) {
            return element.children;
        }

        const { n_qubits, total_steps, depth } = this.metadata;
        const hasData = this.steps.length > 0;
        const current = this.steps[this.currentStep];

        return [
            new MetadataItem(
                'Circuit',
                undefined,
                vscode.TreeItemCollapsibleState.Expanded,
                [
                    new MetadataItem('Qubits', n_qubits !== undefined ? String(n_qubits) : '-'),
                    new MetadataItem('Total gates', total_steps !== undefined ? String(total_steps) : '-'),
                    new MetadataItem('Depth', depth !== undefined ? String(depth) : '-')
                ]
            ),
            new MetadataItem(
                'Current Step',
                undefined,
                vscode.TreeItemCollapsibleState.Expanded,
                [
                    new MetadataItem(
                        'Step',
                        hasData ? `${this.currentStep} / ${Math.max(this.steps.length - 1, 0)}` : '-'
                    ),
                    new MetadataItem('Gate', hasData ? (current?.gate_name ?? '-') : '-'),
                    new MetadataItem(
                        'Global entropy',
                        hasData && current?.global_entropy !== undefined
                            ? current.global_entropy.toFixed(4)
                            : '-'
                    )
                ]
            )
        ];
    }
}
