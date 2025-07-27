import {
	IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	ResourceMapperField,
	// NodeOperationError,
} from 'n8n-workflow';
import { GrpcReflection } from 'grpc-js-reflection-client';

const grpc = require('@grpc/grpc-js');
import {
	fieldsForMethod,
	methodsInService,
	protobufFieldToN8NMapperType,
	protobufFieldToN8NOptions,
	protoStringToPackage,
	protoStringToRoot,
	sendMessageToServer,
	servicesFromProto,
} from './gRPCInspect';
import { Root } from 'protobufjs';
import { PackageDefinition } from '@grpc/proto-loader';

export class gRPCNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'gRPC',
		name: 'grpc',
		group: ['output'],
		version: 1,
		icon: 'file:grpc.svg',
		description: 'Makes a gRPC service call',
		defaults: {
			name: 'gRPC',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		// credentials: [
		// 	{
		// 		name: 'gprcCredentials',
		// 		required: false,
		// 	},
		// ],
		properties: [
			{
				displayName: 'URL',
				name: 'location',
				type: 'string',
				default: '',
				noDataExpression: true,
				placeholder: 'service.com:443',
				description: 'The URL where the service is exposed',
				required: true,
			},
			{
				displayName: 'Protobuf definition',
				name: 'protoSource',
				type: 'options',
				required: true,
				default: 'auto',
				noDataExpression: true,
				options: [
					{
						name: 'Automatic',
						value: 'auto',
						description: 'Fetch from the server (via Reflection service)',
					},
					{
						name: 'From URL',
						value: 'url',
						description: 'Fetch the .proto file from a URL',
					},
					{
						name: 'From .proto file',
						value: 'text',
						description: 'Provide the .proto file as text',
					},
				],
			},
			{
				displayName: '.proto URL',
				description: "Provide a URL that exposes this service's .proto file",
				name: 'protoURL',
				type: 'string',
				required: false,
				noDataExpression: true,
				default: '',
				displayOptions: {
					show: {
						protoSource: ['url'],
					},
				},
			},
			{
				displayName: '.proto text',
				description: "Provide the contents of this service's .proto file",
				name: 'protoText',
				type: 'string',
				required: false,
				noDataExpression: true,
				default: '',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						protoSource: ['text'],
					},
				},
			},
			{
				displayName: 'Service',
				name: 'service',
				type: 'options',
				required: true,
				noDataExpression: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getServices',
				},
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				required: true,
				noDataExpression: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getMethods',
					loadOptionsDependsOn: ['service'],
				},
				displayOptions: {
					show: {
						service: [{ _cnd: { exists: true } }],
					},
				},
			},
			{
				displayName: 'Fields',
				name: 'rpcFields',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['service', 'method'],
					resourceMapper: {
						mode: 'add',
						resourceMapperMethod: 'getFields',
						fieldWords: {
							singular: 'field',
							plural: 'fields',
						},
						addAllFields: true,
						noFieldsError: 'This method has no fields!',
						supportAutoMap: true,
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
						},
						placeholder: 'Add Header',
						default: {
							headers: [{ name: '', value: '' }],
						},
						options: [
							{
								name: 'headers',
								displayName: 'Parameter',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
									},
								],
							},
						],
					},
				],
			},
		],
	};

	methods: INodeType['methods'] = {
		loadOptions: {
			async getServices() {
				let names: string[] = [];
				const mode = this.getNodeParameter('protoSource', 'auto') as 'auto' | 'url' | 'text';
				switch (mode) {
					case 'auto':
						const location = this.getNodeParameter('location') as string;
						const client = new GrpcReflection(location, grpc.ChannelCredentials.createInsecure());
						names = await client.listServices();
						break;
					case 'url':
						names = servicesFromProto(
							await this.helpers.httpRequest({
								method: 'GET',
								url: this.getNodeParameter('protoURL') as string,
							}),
						);
						break;
					case 'text':
						names = servicesFromProto(this.getNodeParameter('protoText') as string);
						break;
				}

				return names.map((n) => ({ name: n, value: n }));
			},
			async getMethods() {
				const mode = this.getNodeParameter('protoSource', 'auto') as 'auto' | 'url' | 'text';
				const service = this.getNodeParameter('service') as string;

				let methods: string[] = [];
				switch (mode) {
					case 'auto':
						const location = this.getNodeParameter('location') as string;
						const client = new GrpcReflection(location, grpc.ChannelCredentials.createInsecure());
						methods = (await client.listMethods(service)).map((m) => m.name);
						break;
					case 'url':
						methods = methodsInService(
							await this.helpers.httpRequest({
								method: 'GET',
								url: this.getNodeParameter('protoURL') as string,
							}),
							service,
						);
						break;
					case 'text':
						methods = methodsInService(this.getNodeParameter('protoText') as string, service);
				}

				return methods.map((m) => ({ name: m, value: m }));
			},
		},
		resourceMapping: {
			async getFields() {
				const mode = this.getNodeParameter('protoSource', 'auto') as 'auto' | 'url' | 'text';
				const service = this.getNodeParameter('service') as string;

				let root: Root;
				switch (mode) {
					case 'auto':
						const location = this.getNodeParameter('location') as string;
						const client = new GrpcReflection(location, grpc.ChannelCredentials.createInsecure());
						root = (await client.getDescriptorBySymbol(`${service}`)).getProtobufJsRoot();
						break;
					case 'url':
						root = protoStringToRoot(
							await this.helpers.httpRequest({
								method: 'GET',
								url: this.getNodeParameter('protoURL') as string,
							}),
						);
						break;
					case 'text':
						root = protoStringToRoot(this.getNodeParameter('protoText') as string);
				}

				const method = this.getNodeParameter('method') as string;
				const protobufFields = fieldsForMethod(root, service, method);
				const fields = protobufFields.map((f): ResourceMapperField => {
					return {
						id: f.name,
						displayName: f.comment ? `${f.name} - ${f.comment}` : f.name,
						defaultMatch: false,
						required: !f.optional,
						display: true,
						type: protobufFieldToN8NMapperType(f),
						options: protobufFieldToN8NOptions(f),
					};
				});
				return { fields };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const location = this.getNodeParameter('location', 0) as string;
		const service = this.getNodeParameter('service', 0) as string;
		const method = this.getNodeParameter('method', 0) as string;
		const mode = this.getNodeParameter('protoSource', 0, 'auto') as 'auto' | 'url' | 'text';
		let protoText: string, pkg: PackageDefinition;
		switch (mode) {
			case 'auto':
				const location = this.getNodeParameter('location', 0) as string;
				const client = new GrpcReflection(location, grpc.ChannelCredentials.createInsecure());
				const descriptor = await client.getDescriptorBySymbol(`${service}`);
				pkg = descriptor.getPackageDefinition();
				break;
			case 'url':
				protoText = await this.helpers.httpRequest({
					method: 'GET',
					url: this.getNodeParameter('protoURL', 0) as string,
				});
				pkg = protoStringToPackage(protoText);
				break;
			case 'text':
				protoText = this.getNodeParameter('protoText', 0) as string;
				pkg = protoStringToPackage(protoText);
		}

		const outputItems: INodeExecutionData[][] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			// try {
			const fields = this.getNodeParameter('rpcFields.value', itemIndex, []) as IDataObject;

			const headers = this.getNodeParameter('options.headers.headers', itemIndex, []) as [
				{
					name: string;
					value: string;
				},
			];

			const resp = await sendMessageToServer(location, service, method, pkg, fields, headers ?? []);
			outputItems.push(
				resp.map((x) => ({
					json: x,
					pairedItem: {
						item: itemIndex,
					},
				})),
			);
			// } catch (error) {
			// 	// This node should never fail but we want to showcase how
			// 	// to handle errors.
			// 	if (this.continueOnFail()) {
			// 		items.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
			// 	} else {
			// 		// Adding `itemIndex` allows other workflows to handle this error
			// 		if (error.context) {
			// 			// If the error thrown already contains the context property,
			// 			// only append the itemIndex
			// 			error.context.itemIndex = itemIndex;
			// 			throw error;
			// 		}
			// 		throw new NodeOperationError(this.getNode(), error, {
			// 			itemIndex,
			// 		});
			// 	}
			// }
		}

		return [outputItems.flat()];
	}
}
